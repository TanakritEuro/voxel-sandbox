// Entry point. The world list, unless the URL names a world to play (`?world=<id>`, from the
// list) or asks for an unsaved one to look at or measure (`?seed=`, `?at=`, `?autofly`); then
// the game (`game.ts`), loaded only then, so the list comes up without Three.js.

import { isUnsavedUrl } from './save/worlds';

const params = new URLSearchParams(location.search);
if (params.has('world') || isUnsavedUrl(params)) await import('./game');
else await (await import('./ui/worldList')).showWorldList();
