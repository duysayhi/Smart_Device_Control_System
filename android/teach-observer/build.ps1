$ErrorActionPreference='Stop'
$projectRoot=$PSScriptRoot
$sdk=Join-Path $env:LOCALAPPDATA 'Android/Sdk'
$tools=Join-Path $sdk 'build-tools/36.0.0'
$android=Join-Path $sdk 'platforms/android-37.0/android.jar'
$out=Join-Path $projectRoot 'build'
New-Item -ItemType Directory -Force -Path $out,(Join-Path $out 'classes'),(Join-Path $out 'dex') | Out-Null
$javaFiles=Get-ChildItem (Join-Path $projectRoot 'src') -Filter *.java -Recurse | ForEach-Object FullName
& javac --release 8 -classpath $android -d (Join-Path $out 'classes') @javaFiles
if($LASTEXITCODE -ne 0){throw 'javac failed'}
$classFiles=Get-ChildItem (Join-Path $out 'classes') -Filter *.class -Recurse | ForEach-Object FullName
& (Join-Path $tools 'd8.bat') --lib $android --min-api 26 --output (Join-Path $out 'dex') @classFiles
if($LASTEXITCODE -ne 0){throw 'd8 failed'}
& (Join-Path $tools 'aapt.exe') package -f -M (Join-Path $projectRoot 'AndroidManifest.xml') -S (Join-Path $projectRoot 'res') -I $android -F (Join-Path $out 'unsigned.apk')
if($LASTEXITCODE -ne 0){throw 'aapt failed'}
& jar uf (Join-Path $out 'unsigned.apk') -C (Join-Path $out 'dex') classes.dex
if($LASTEXITCODE -ne 0){throw 'jar failed'}
& (Join-Path $tools 'zipalign.exe') -f 4 (Join-Path $out 'unsigned.apk') (Join-Path $out 'aligned.apk')
if($LASTEXITCODE -ne 0){throw 'zipalign failed'}
$key=Join-Path $out 'local-debug.keystore'
if(!(Test-Path $key)){& keytool -genkeypair -keystore $key -storepass android -keypass android -alias local-debug -keyalg RSA -keysize 2048 -validity 365 -dname 'CN=Local Phone Commander Debug';if($LASTEXITCODE -ne 0){throw 'keytool failed'}}
& (Join-Path $tools 'apksigner.bat') sign --ks $key --ks-pass pass:android --key-pass pass:android --out (Join-Path $out 'phone-commander-observer.apk') (Join-Path $out 'aligned.apk')
if($LASTEXITCODE -ne 0){throw 'APK sign failed'}
& (Join-Path $tools 'apksigner.bat') verify (Join-Path $out 'phone-commander-observer.apk')
if($LASTEXITCODE -ne 0){throw 'APK verification failed'}
Get-FileHash (Join-Path $out 'phone-commander-observer.apk') -Algorithm SHA256
