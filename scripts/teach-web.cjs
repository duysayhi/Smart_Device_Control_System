// Load the environment in the parent without forwarding Node CLI env-file flags.
const envFile=process.env.PHONE_COMMANDER_ENV_FILE;
if(envFile)process.loadEnvFile(envFile);
delete process.env.PHONE_COMMANDER_ENV_FILE;
const next=require.resolve('next/dist/bin/next');
process.argv=[process.execPath,next,...process.argv.slice(2)];
require(next);
