// Evaluation-only data. Runtime must never import this fixture.
module.exports = Object.freeze([
  { id: 'A1', group: 'APPLICATION', app: 'org.holdout.archive', label: 'Exhibitions', widget: 'com.google.android.material.navigation.NavigationBarItemView', expected: 'COMPLETED' },
  { id: 'A2', group: 'APPLICATION', app: 'net.holdout.transit', label: 'Departures', widget: 'android.widget.TabWidget', expected: 'COMPLETED' },
  { id: 'A3', group: 'APPLICATION', app: 'io.holdout.custom', label: 'Collections', widget: 'io.custom.UnclassifiedControl', expected: 'BLOCKED' },
  { id: 'S1', group: 'INITIAL_STATE', app: 'org.holdout.archive', label: 'Exhibitions', widget: 'com.google.android.material.navigation.NavigationBarItemView', selected: true, expected: 'COMPLETED' },
  { id: 'S2', group: 'INITIAL_STATE', app: 'org.holdout.archive', label: 'Exhibitions', widget: 'com.google.android.material.navigation.NavigationBarItemView', duplicate: true, expected: 'BLOCKED' },
  { id: 'S3', group: 'INITIAL_STATE', app: 'org.holdout.archive', label: 'Exhibitions', widget: 'com.google.android.material.navigation.NavigationBarItemView', uncertain: true, expected: 'BLOCKED' },
  { id: 'S4', group: 'INITIAL_STATE', app: 'org.holdout.archive', label: 'Exhibitions', widget: 'com.google.android.material.navigation.NavigationBarItemView', overlay: true, expected: 'BLOCKED' },
  { id: 'T1', group: 'TASK', request: 'Compare the humidity readings without changing any saved measurements.', expected: 'DISCOVERY_REQUIRED' },
  { id: 'T2', group: 'TASK', request: 'Organize an itinerary around the accessible locations.', expected: 'DISCOVERY_REQUIRED' },
  { id: 'T3', group: 'TASK', request: 'Identify which local certificate expires first.', expected: 'DISCOVERY_REQUIRED' },
]);
