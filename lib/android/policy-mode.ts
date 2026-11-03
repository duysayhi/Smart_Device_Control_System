export function developmentPolicyEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ANDROID_POLICY_MODE === 'development';
}
