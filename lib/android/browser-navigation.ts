import type { Observation } from './state-observer';

// Evidence for reversible native navigation only; no tab selection or settings change is authorized.
export function navigationLayers(snapshot: Pick<Observation, 'foregroundPackage' | 'observationStatus' | 'nodes'>): string[] {
  if (snapshot.foregroundPackage !== 'com.android.chrome' || snapshot.observationStatus !== 'OBSERVED') return [];
  const ids = new Set(snapshot.nodes.filter(n => n.packageName === snapshot.foregroundPackage && n.enabled && n.displayed !== false).map(n => n.resourceId));
  const prefix = 'com.android.chrome:id/';
  if (!ids.has(prefix + 'tab_switcher_view_holder') || !ids.has(prefix + 'hub_main_container')) return [];
  const layers = ['TAB_OVERVIEW'];
  if (ids.has(prefix + 'bottom_sheet') && ids.has(prefix + 'promo_title_text') && ids.has(prefix + 'promo_yes_button')) layers.push('INFORMATION_SHEET');
  return layers;
}
