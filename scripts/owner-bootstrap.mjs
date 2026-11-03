// Local operator bootstrap only. No HTTP enrollment token issuance or credential reset.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import cp from 'node:child_process';
const fail=code=>{throw Error(code);};
try{
 if(process.platform!=='win32')fail('OWNER_WINDOWS_BOOTSTRAP_REQUIRED');
 const index=process.argv.indexOf('--origin'),origin=process.argv[index+1];
 if(index<0||!/^http:\/\/localhost:[0-9]{2,5}$/.test(origin)||Number(new URL(origin).port)>65535)fail('OWNER_LOCALHOST_ORIGIN_REQUIRED');
 const output=cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{encoding:'utf8',windowsHide:true});
 const sid=output.stdout?.trim();if(output.status!==0||!/^S-1-[0-9-]+$/.test(sid))fail('OWNER_OS_IDENTITY_UNAVAILABLE');
 const root=process.cwd();let directory=root;
 for(const part of ['data','teach-mode','owner-auth']){directory=path.join(directory,part);if(!fs.existsSync(directory))fs.mkdirSync(directory);if(fs.lstatSync(directory).isSymbolicLink()||!fs.lstatSync(directory).isDirectory())fail('OWNER_PATH_REJECTED');}
 const file=path.join(directory,'owner.json');let prior;
 const prepareIssuer=process.argv.includes('--prepare-issuer');
 if(fs.existsSync(file)){if(fs.lstatSync(file).isSymbolicLink())fail('OWNER_PATH_REJECTED');prior=JSON.parse(fs.readFileSync(file,'utf8'));if(prior.credential&&!prepareIssuer)fail('OWNER_ALREADY_ENROLLED_NO_RESET');if(prior.osOwnerSha256!==crypto.createHash('sha256').update(sid).digest('hex')||prior.origin!==origin)fail('OWNER_OS_IDENTITY_MISMATCH');}
 const quote=value=>"'"+value.replaceAll("'","''")+"'";
 const secure=`$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetAccessRuleProtection($true,$false); $acl.SetOwner($sid); foreach($who in @($sid,(New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')))){ $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($who,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule) }; Set-Acl -LiteralPath ${quote(directory)} -AclObject $acl -ErrorAction Stop`;
 const verify=`$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=Get-Acl -LiteralPath ${quote(directory)} -ErrorAction Stop; if(-not $acl.AreAccessRulesProtected){exit 2}; $allowed=@($acl.Access|Where-Object {$_.AccessControlType -eq 'Allow'}); if(@($allowed|Where-Object {$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin @($sid.Value,'S-1-5-18')}).Count -ne 0){exit 3}; if(@($allowed|Where-Object {$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq $sid.Value -and ($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl}).Count -eq 0){exit 4}`;
 if(!prior){const secured=cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',secure],{stdio:'ignore',windowsHide:true});if(secured.status!==0)fail('OWNER_PRIVATE_ACL_REQUIRED');}
 const checked=cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',verify],{stdio:'ignore',windowsHide:true});if(checked.status!==0)fail('OWNER_PRIVATE_ACL_REQUIRED');
 if(prepareIssuer){
  if(!prior?.credential)fail('OWNER_PASSKEY_ENROLLMENT_REQUIRED');const privateFile=path.join(directory,'issuer-private.der');
  if(prior.issuerPublicKey){if(!fs.existsSync(privateFile)||fs.lstatSync(privateFile).isSymbolicLink())fail('OWNER_ISSUER_INCONSISTENT');const current=crypto.createPublicKey(crypto.createPrivateKey({key:fs.readFileSync(privateFile),type:'pkcs8',format:'der'})).export({type:'spki',format:'der'}).toString('base64url');if(current!==prior.issuerPublicKey)fail('OWNER_ISSUER_INCONSISTENT');}
  else {if(fs.existsSync(privateFile))fail('OWNER_ISSUER_INCONSISTENT');const pair=crypto.generateKeyPairSync('ed25519');fs.writeFileSync(privateFile,pair.privateKey.export({type:'pkcs8',format:'der'}),{flag:'wx',mode:0o600});const state={...prior,revision:prior.revision+1,issuerPublicKey:pair.publicKey.export({type:'spki',format:'der'}).toString('base64url')};const temporary=path.join(directory,crypto.randomUUID()+'.tmp');fs.writeFileSync(temporary,JSON.stringify(state),{flag:'wx',mode:0o600});fs.renameSync(temporary,file);}
  console.log(JSON.stringify({issuerPrepared:true,ownerCredentialPreserved:true,secretsPrinted:false}));process.exit(0);
 }
 const secret=crypto.randomBytes(32).toString('hex'),expiresAt=Date.now()+300000;
 const state={version:1,origin,osOwnerSha256:crypto.createHash('sha256').update(sid).digest('hex'),revision:(prior?.revision??0)+1,
   bootstrap:{hash:crypto.createHash('sha256').update(secret).digest('hex'),expiresAt,consumed:false},audit:prior?.audit??[]};
 const temp=path.join(directory,crypto.randomUUID()+'.tmp');fs.writeFileSync(temp,JSON.stringify(state),{mode:0o600,flag:'wx'});fs.renameSync(temp,file);
 let opened=false;
 if(process.argv.includes('--open')){const url=origin+'/owner#bootstrap='+secret;
  const launched=cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Start-Process -FilePath '+quote(url)],{stdio:'ignore',windowsHide:true});opened=launched.status===0;}
 console.log(JSON.stringify({origin,bootstrapPrepared:true,privateAclApplied:true,expiresAt,browserOpened:opened,secretsPrinted:false}));
}catch(error){console.error(JSON.stringify({code:/^[A-Z0-9_]+$/.test(error.message)?error.message:'OWNER_BOOTSTRAP_FAILED',secretsPrinted:false}));process.exitCode=1;}
