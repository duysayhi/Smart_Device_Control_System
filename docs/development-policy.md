# Development Policy

For local development, set `ANDROID_POLICY_MODE=development` in `.env.local`.
This skips sensitivity, unknown-action and Wi-Fi confirmation gates. It can
permit account, communication and settings changes on the selected phone.
Only run locally on a test device you control.

Uninstall, deletion, clearing data and reset controls remain blocked.
Device/session validation, native element grounding, password-input restrictions,
supported executor capabilities and result verification are unchanged.
This is not a general-purpose action implementation or permission to click blindly.

Set `ANDROID_POLICY_MODE=strict` to restore the policy. Restart Next.js and any
idle agent worker after changing the value; an already-running process may still
hold its previous environment. Never restart a worker with an active execution.
Production (`NODE_ENV=production`) always ignores development mode.
