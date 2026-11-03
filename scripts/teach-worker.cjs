const envFile=process.env.PHONE_COMMANDER_ENV_FILE;if(envFile)process.loadEnvFile(envFile);delete process.env.PHONE_COMMANDER_ENV_FILE;
process.env.AGENT_CLOUD_REASONING_ENABLED='false';process.env.AGENT_GROQ_ENABLED='false';process.env.AGENT_GROQ_SEND_COMMAND_TEXT='false';
require('./agent-worker.cjs');
