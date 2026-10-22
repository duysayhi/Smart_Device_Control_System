import type { UiNode } from '../targets';

export type StructuralRole = 'navigation' | 'action' | 'editable' | 'selection' | 'collection' | 'dialog' | 'media' | 'form' | 'unknown';

// Class evidence describes affordances, not permission to activate a widget.
export function structuralRoles(node: Pick<UiNode, 'className' | 'checkable' | 'scrollable'>): StructuralRole[] {
  const roles: StructuralRole[] = [], name = node.className;
  if (/(?:^|\.)(?:Button|ImageButton|MaterialButton)$/.test(name)) roles.push('action');
  if (/(?:\$Tab|\.Tab|TabWidget|NavigationBarItemView|NavigationMenuItemView|BottomNavigationItemView)$/.test(name)) roles.push('navigation');
  if (/EditText|AutoCompleteTextView/.test(name)) roles.push('editable');
  if (node.checkable || /Spinner|NumberPicker|TimePicker|DatePicker|RadioGroup/.test(name)) roles.push('selection');
  if (node.scrollable || /RecyclerView|ListView|GridView/.test(name)) roles.push('collection');
  if (/Dialog/.test(name)) roles.push('dialog');
  if (/VideoView|SurfaceView|TextureView|MediaController/.test(name)) roles.push('media');
  if (/TextInputLayout/.test(name)) roles.push('form');
  return roles.length ? roles : ['unknown'];
}
