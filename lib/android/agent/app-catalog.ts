import type { AdbRunner } from '../executor';
import { checkCancellation } from '../errors';
import { discoverApplication, hasCategoryIntent, type DiscoveredApplication } from './application-discovery';
import { foldIntent } from './outcome-spec';
import { readLauncherLabels, type LabelReadOptions } from './launcher-labels';

export interface CatalogEntry { deviceId: string; packageName: string; component: string; label?: string; labels?: string[]; observedAt: number; provenance: 'PACKAGE_MANAGER'; enabled: 'LAUNCHABLE' }
export class AppCatalog {
  private entries: CatalogEntry[] = [];
  private observedAt = 0;
  private labelsLoaded = false;
  readonly limitations = ['Launcher labels require locally installed Android SDK aapt2 and readable installed APK resources; unavailable labels never become guessed names.'];
  constructor(private readonly serial: string, private readonly run: AdbRunner, private readonly labels = readLauncherLabels, private readonly labelOptions: LabelReadOptions = {}) {}
  async planningInventory(signal?: AbortSignal): Promise<CatalogEntry[]> {
    const entries = await this.inventory(signal);
    const labels = await this.labels(this.serial, entries.map(e => e.component), this.run, signal, { ...this.labelOptions, ...(this.labelsLoaded ? { maxExtractions: 0 } : {}) });
    this.labelsLoaded = true;
    this.entries = entries.map(row => ({ ...row, ...(labels.get(row.component)?.length ? { label: labels.get(row.component)![0], labels: [...labels.get(row.component)!] } : {}) }));
    return this.entries.map(row => ({ ...row }));
  }
  async inventory(signal?: AbortSignal, force = false): Promise<CatalogEntry[]> {
    checkCancellation(signal);
    if (!force && Date.now() - this.observedAt < 30000) return this.entries.map(row => ({ ...row }));
    const result = await this.run(['-s', this.serial, 'shell', 'cmd', 'package', 'query-activities', '--brief', '--components', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER'], 10000);
    checkCancellation(signal);
    const components = [...new Set(result.stdout.split(/\r?\n/).map(row => row.trim()).filter(row => /^[A-Za-z0-9_.$]+\/[A-Za-z0-9_.$]+$/.test(row)))];
    this.observedAt = Date.now();
    this.entries = components.slice(0, 500).map(component => ({ deviceId: this.serial, packageName: component.split('/')[0], component,
      observedAt: this.observedAt, provenance: 'PACKAGE_MANAGER', enabled: 'LAUNCHABLE' }));
    return this.entries.map(row => ({ ...row }));
  }
  async resolve(name: string | undefined, capability: string, signal?: AbortSignal): Promise<{ app?: DiscoveredApplication; choices: CatalogEntry[]; reason?: string }> {
    const requested = name ?? (capability === 'CALCULATE' ? 'calculator' : capability === 'CAPTURE_MEDIA' ? 'camera' : capability === 'FIND_ARTIFACT' ? 'gallery' : undefined);
    if (!requested) return { choices: [], reason: 'NEEDS_CLARIFICATION: application/capability has no unique proven default.' };
    const explicitPackage = /^[A-Za-z][\w]*(?:\.[\w]+)+$/.test(requested);
    try { if (explicitPackage || !name || hasCategoryIntent(requested)) return { app: await discoverApplication(this.serial, requested, this.run, signal), choices: [] }; }
    catch (error) {
      checkCancellation(signal);
      if (error instanceof Error && /Invalid application|Invalid discovery/.test(error.message)) throw error;
      if (capability === 'CAPTURE_MEDIA' || ['camera', 'may anh', 'cam'].includes(foldIntent(requested))) return { choices: [], reason: 'CAMERA_DEFAULT_AMBIGUOUS: no unique still-image intent handler; no label fallback.' };
    }
    // Subsequent reads recheck identity/revisions but do not repeat a partial APK scan in one transaction.
    const inventory = await this.planningInventory(signal);
    const exact = inventory.filter(row => [row.label, ...(row.labels ?? [])].some(label => label && foldIntent(label).trim() === foldIntent(requested).trim()));
    const packages = [...new Set(exact.map(row => row.packageName))];
    if (packages.length === 1) return { app: await discoverApplication(this.serial, packages[0], this.run, signal), choices: [] };
    const words = foldIntent(requested).split(/\s+/).filter(Boolean);
    const choices = exact.length ? exact : inventory.filter(row => words.every(word => row.packageName.toLowerCase().split(/[._]/).includes(word)));
    return { choices: choices.slice(0, 12), reason: 'NEEDS_CLARIFICATION: application display label is unknown or ambiguous; specify an exact installed package.' };
  }
  async select(packageName: string, signal?: AbortSignal): Promise<DiscoveredApplication> {
    const entries = await this.inventory(signal, true);
    if (!entries.some(row => row.packageName === packageName)) throw new Error('Selected application disappeared from the device catalog.');
    return discoverApplication(this.serial, packageName, this.run, signal);
  }
}
