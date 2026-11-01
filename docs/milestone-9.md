# Milestone 9: multiplayer

**Plan approved (2026-11-01)** as proposed: PeerJS with the host's browser owning the world, up to
four players, guests' edits saved in the host's world (guests keep nothing and start by the host),
no one taking over when the host leaves, no chat for now, and the host's game not pausing while
open to friends.

**Goal.** Play a world together:
- you open your world to friends from the pause menu and get a four-letter code;
- up to three friends join with the code from the world list;
- everyone walks, digs and builds in the same world and sees each other;
- the water flows and the animals wander the same for all;
- your world keeps everything they build, saved in your browser as now.

The game stays inside its budget for the host and for every guest: 60 fps on a laptop at radius 8,
no frame over 20 ms flying.

## The big choice: how browsers reach each other (to agree)

The roadmap says "a Node WebSocket server that owns the world". The earlier games' online code
(\`../penalty-shootout\`, \`../five-a-side\`, \`../racing-game\`, \`src/online/link.ts\`) does something
else. It uses **PeerJS**: browsers talk to each other directly (WebRTC), and the free public PeerJS
server only introduces them. One player's browser hosts.

| | PeerJS, the host's browser owns the world (recommended) | A Node WebSocket server owns the world |
| --- | --- | --- |
| Hosting | Nothing new: the game stays on GitHub Pages | A server to run, pay for and keep up (GitHub Pages can't run one) |
| The world | The host's, saved in the host's browser as now | On the server's disk; worlds there, not in browsers |
| Playing | Only while the host plays | Any time, without the owner |
| Reaching each other | Direct; fails on some strict networks (no relay server) | Always, through the server |
| Code | \`link.ts\`, \`loopback.ts\` and the message checking ported; the rest new | All new, plus a second program to build, test and deploy |

I'd take **PeerJS**. It needs nothing beyond what the game has now, it's proven in three games, and
your worlds stay where they are. Everything below assumes it. With a server instead, the world and
session code would move into it, and the plan would need redoing.

## Design

### 1. The link (\`net/link.ts\`, \`net/loopback.ts\`)
- **Ported from the racing game,** with two changes:
  - **A room takes up to three guests,** not one. The host holds a link per guest, and a guest has
    one link, to the host. Everything goes through the host (a star).
  - **Room codes** get the prefix \`voxel-sandbox-1-\`.
- **Two channels per link,** as before: reliable and ordered for events (edits, chunks, joining),
  unordered for frequent states (players, mobs), where only the newest matters.
- **Heartbeats:** a link goes quiet after 6 s and closes, as before.
- **The loopback** (two ends in one process, with delay and jitter) is ported for tests, extended
  to one host and several guests.

### 2. Who owns what
- **The host owns the world.** Its saved world, its seed, its clock (time of day), its water and
  its mobs.
- **A guest plays an unsaved copy:**
  - **Land:** it generates the land itself from the seed (generation is deterministic, so the land
    is identical) and gets only the edited chunks from the host.
  - **Saves on the host:** a guest's edits are saved in the host's world. A guest saves nothing.
- **Each player moves themself.** Physics runs in each browser, as now, and the others see where you
  are. No one waits for the host to walk.

### 3. Joining (\`net/protocol.ts\`, \`net/session.ts\`)
- **Hello and welcome:**
  - **Guest → host, \`hello\`:** the protocol version and the player's name.
  - **Host → guest, \`welcome\`:** a player number, the seed, the time of day, everyone in the
    game (names, numbers, where they are), and the list of columns with edited chunks.
  - **Turned away:** a full room, or a different version (generation must match exactly, so the
    version goes up with any change to generation).
- **A guest starts by the host,** on land near them.

### 4. Chunks (\`net/remoteSaves.ts\`)
- **The loader already asks \`ChunkSaves\`** whether a column has saved chunks and reads them before
  generating it.
  - On a guest that's a \`RemoteSaves\`: \`has\` answers from the list of edited columns (kept up to
    date by the host), and \`load\` asks the host.
  - The host answers with the column's edited chunks: from memory if loaded (with edits not yet
    written), else from its store. RLE as saved, about 2 KB a chunk.
  - So a guest gets exactly what the host has, and the loader needs no change.
- **Edits arriving while a column is being asked for** are kept and made once it has loaded. Making
  an edit twice does nothing.

### 5. Edits
- **A guest's edit** (break or place) shows at once on its own screen, then goes to the host as a
  request.
- **The host checks it:**
  - within reach of that player;
  - placeable;
  - not inside anyone;
  - torches on a face.
- **The host makes it** as its own edit (light, saving, waking the water), then sends it to everyone.
  - The guest whose edit it was takes the host's answer as final.
  - An edit the host refused is put back.
- **The host's own edits** go to everyone too.
- **Water:** each tick's changes go to every guest as one packed message (\`Int32Array\`, 16 bytes a
  block), made there with \`setBlocks\` and remeshed in the workers. Guests don't run the water.

### 6. Players (\`net/playerState.ts\`, \`net/remotePlayer.ts\`, \`render/playerRenderer.ts\`)
- **Each player's state 20 times a second,** unordered: position, look, flying, crouching,
  swimming, the held block, and a swing when digging or placing.
  - Guests send theirs to the host; the host passes them on.
  - Packed as a \`Float32Array\` of about 40 bytes.
- **\`RemotePlayer\`:** states turned into a pose now, after the racing game's \`RemoteCar\`. Drawn a
  tenth of a second behind, between states, dead-reckoned briefly past the newest, and corrections
  eased.
- **The avatar** (invented): a blocky figure with head, body, arms and legs.
  - Legs swing as it walks, the head turns where it looks, and an arm swings when it digs.
  - Each player has a colour by number, and a name above the head.
  - Drawn like the mobs: an InstancedMesh per part, lit by the world.
- **Sounds:** others' footsteps and digging, quieter with distance (\`heard\`).

### 7. Mobs and time
- **The host runs the mobs for everyone.** \`MobManager\` spawns around every player and despawns
  beyond 96 blocks from all of them. The cap goes up with players: 24 each, 48 in all at most.
- **Mob states go to guests** 10 times a second, unordered: position, facing, what poses need
  (state, speed, distance walked, on the ground, hurt).
  - Guests draw them between states, as remote players.
  - Mob sounds go with them.
- **A guest's hit** is a request. The host checks the reach and makes it, and the knockback, the
  red flash and the puff reach everyone.
- **Time of day:** the host's, sent every few seconds, eased on guests. Not shared while paused:
  the host's game doesn't pause once it's open to friends (as in the racing game).

### 8. Menus (\`ui/\`)
- **Pause menu, "Open to friends":** shows the code and who's in. "Close" sends guests home.
- **World list, "Join a friend":** a code and a name (the name kept in settings).
- **On screen:** who's in, the code, and a line when someone joins or leaves.
- **When the host leaves or the link is lost,** guests go back to the world list with the reason.
  No one takes over as host.
- **\`?stats\`:** a network line: players, bytes a second in and out, messages a second, round trip.

## Files
- **New:**
  - \`net/link.ts\`, \`net/loopback.ts\` (ported and extended);
  - \`net/protocol.ts\` (messages, checked on arrival, \`PROTOCOL\`);
  - \`net/session.ts\` (\`HostSession\`, \`GuestSession\`: joining, chunks, edits, water, mobs,
    players; pure, the clock passed in);
  - \`net/remoteSaves.ts\`, \`net/playerState.ts\`, \`net/remotePlayer.ts\`;
  - \`render/playerRenderer.ts\`, \`ui/joinPanel.ts\`.
- **Changed:**
  - \`game.ts\`: a game is local, hosting or a guest;
  - \`mobs/mobs.ts\`: several players, states out and in;
  - \`ui/pauseMenu.ts\`, \`ui/worldList.ts\`, \`settings.ts\` (name);
  - \`stats.ts\`, \`config.ts\` (\`TUNING.net\`);
  - \`package.json\` (\`peerjs\`);
  - CLAUDE.md.

## Tests (headless, over the loopback with delay and jitter)
- **Joining:**
  - a guest joins and gets the seed, time and edited columns;
  - a fourth guest and a wrong version are turned away;
  - a guest leaving or going quiet is noticed by the host, and the host leaving by guests.
- **Chunks:**
  - a guest's world matches the host's after loading the same columns, edited chunks included;
  - an edit arriving while its column is being asked for still lands.
- **Edits:**
  - a guest's edit reaches the host and the other guests;
  - a refused one (out of reach, inside a player) is put back;
  - two players editing the same block end the same everywhere (the host's order).
- **Water:** a source placed by a guest flows the same on every guest as on the host.
- **Players:**
  - packed states round-trip;
  - \`RemotePlayer\` lies between states, and eases a correction;
  - a state from the past or out of order is ignored.
- **Mobs:** spawning round two players far apart; a guest's hit removes the mob for everyone after
  three.
- **Messages:** every message survives \`parseMessage\`, and junk is turned away.

## Measuring
- **Bytes a second each way per guest:** standing, walking, flying (chunks), digging, and during a
  flood. The target is under 50 KB/s each way, apart from chunks while flying.
- **Host frame times** with three guests over the loopback, and the cost of the session per frame.
- **In Chrome,** two windows side by side (host and guest, both visible so neither is throttled):
  frame times on both, \`?autofly\` on the guest, and an edit's round trip.

## Steps (each built, tested, measured, committed and pushed)
1. **The link and the loopback** for several guests, and the messages, with tests.
2. **Joining and chunks:** sessions, \`RemoteSaves\`, a guest's world matching the host's; edits
   both ways; tested over the loopback.
3. **Players:** states, \`RemotePlayer\`, the avatar, names; join and leave lines.
4. **Water, mobs, hits and time** from the host.
5. **Menus:** open to friends, join a friend, leaving; tried in two Chrome windows.
6. **Measurements,** notes and playtest questions.

## Decisions to agree
- **PeerJS,** the host's browser owning the world (recommended), or a Node WebSocket server?
- **Up to four players** (the host and three guests)?
- **Guests' edits saved in the host's world;** guests keep nothing, and start by the host each time?
- **No host taking over:** when the host leaves, the game ends for everyone?
- **Chat:** none now (easy to add later), or a short text chat (T)?
- **The host's game doesn't pause** while open to friends?

## Step 1: the link, the test network and the messages for joining — built (2026-11-01)

**What changed:**
- **`peerjs` 1.5.5,** the version the earlier games use.
- **`net/link.ts`,** ported from the racing game.
  - **A room now takes several guests.** Each guest's two connections (`events`, `frames`) make a
    link of its own, handed to `room.onGuest`. A guest's link closing doesn't close the room, and
    `room.close()` hangs up on them all.
  - At most 8 links: the session will turn away a fourth guest politely, and this stops a flood.
  - Heartbeats and the 6 s silence limit as before. The prefix is `voxel-sandbox-1-`.
  - A guest that can't be reached is that guest's error, not the room's.
- **`net/roomCode.ts`:** the four-character codes, apart from `link.ts` so tests can use them
  without loading PeerJS.
- **`net/loopback.ts`, `Network`:** as many linked pairs as wanted on one virtual clock.
  - Delay with jitter. The reliable channel keeps its order; the unordered one may reorder.
  - Messages arrive as structured clones.
  - A cut line closes both its ends after the silence; other lines go on.
  - `network.room()` gives a room that guests `join()`, as over PeerJS.
- **`net/protocol.ts`:** the messages for joining, each checked on arrival.
  - `hello` (version, name), `welcome` (your number, the seed, the time of day, who's in, where the
    host stands, the edited columns), `reject`, `joined`, `left`, `ping` / `pong`, `bye`.
  - `PROTOCOL` is 1, bumped with any change to messages or to world generation.
  - `cleanName`: white space to single spaces, control and invisible characters out, at most 16
    characters (by character, not code unit).
- Nothing in the game uses them yet (step 5), so the build doesn't include PeerJS yet, and there was
  nothing to look at in a browser.

**Tests (9 new, 294 in all):**
- **The network:**
  - delivers after the delay, as copies, the reliable channel in order through jitter;
  - may reorder the unordered channel;
  - gives each guest of a room its own line, and closing the room hangs up on all of them;
  - closes a cut line's ends after the silence, and only that line's;
  - tells the other end when one hangs up.
- **Room codes:** fresh ones read easily, typed ones are tidied, and wrong ones are turned away.
- **Messages:**
  - every message survives the network and checking;
  - 24 kinds of junk are turned away (wrong types, a guest numbered 0 or 4, players repeated or
    too many, a time of 1, odd or out-of-range columns, NaN, long reasons);
  - names are tidied.

## Step 2: joining, chunks and edits — built (2026-11-01)

**What changed:**
- **`net/session.ts`, `HostSession`:**
  - **Greeting:** a guest's link hears nothing but a `hello` until it's in. Another version or a
    full world (four players) is turned away with a reason.
  - **The welcome:** the lowest free player number, the seed, the time of day, who's in, where the
    host stands, and every column with edited chunks.
  - **Joining and leaving:** the others are told. A guest leaving, or going quiet for 6 s, frees
    its number.
  - **Columns:** answers each `ask` with the column's edited chunks.
  - **Edits:** checks each guest's edit through the game. Made, it goes to every guest; refused, the
    asker hears what the block is.
  - **`shareEdits`** sends the host's own blocks set (step 4 sends the water's the same way).
  - **`close`** sends everyone home.
- **`GuestSession`:**
  - says hello, and `welcome` resolves with the host's answer (or rejects with why not);
  - `edit` sends the player's edit, already shown, with a number;
  - makes every block the host sets in the host's order, its own confirmed ones included;
  - a refused edit is put back to the host's block;
  - pings every 2 s for the round trip and the host's clock;
  - `onClose` when the host leaves, refuses, or the line goes quiet.
- **`RemoteSaves`:** the loader's `ChunkSaves` on a guest, so the loader needs no change.
  - `has` answers from the edited columns (the welcome's, and every column a host edit has touched
    since).
  - `load` asks the host. Each chunk that comes back is checked (`checkChunk`: it must decode to
    exactly a chunk of blocks that exist) before it goes near a worker.
- **Edits for columns a guest hasn't got:** the guest keeps the latest block for each place, and
  makes them when the column is added. That covers a column being made when they arrive (asked
  for, or generating). For one whose chunks already had them, making them again changes nothing.
  At most 200,000 kept; past that the oldest columns' go (the host has them).
- **`net/hostWorld.ts`:** the host's world as its session sees it.
  - A column's edited chunks come from memory when it's loaded (unwritten edits included), from
    the save when not.
  - A guest may set air, a block from the picker, or a torch, in a column the host has loaded, if
    the game allows it (reach, not inside anyone: step 3, once the host knows where guests are).
- **`WorldSaver.heights` and `editedColumns`:** saved chunks and those waiting to be.
- **Messages:** `ask`, `column` (chunks RLE, about 2 KB each on average), `edit`, `edits` (packed
  16 bytes a block), `refused`.

**A gap, for step 3:** the host refuses edits in columns it hasn't loaded, and the host loads land
only round itself. A guest far from the host couldn't build. Step 3 sends where everyone is, and the
host will then keep the land round each guest loaded (generated, not drawn). Mobs and water round
guests (step 4) need it too.

**Tests (10 new, 304 in all), a real host world and saver, guests generating their own land, over
the test network with 40 ms ± 20 ms:**
- **Joining:**
  - the welcome carries the seed, time, players, the host's place and the edited columns;
  - a fourth guest and another version are turned away;
  - the others hear who joins and leaves, and numbers are freed;
  - a guest going quiet is dropped after the silence;
  - closing the world sends guests home.
- **The world:**
  - a guest's world matches the host's, blocks and light, after loading the same nine columns,
    with edits both written and not yet written;
  - a guest's edits show at once, reach the host and the other guest;
  - a refused edit is put back, and moving water is refused whatever the game says;
  - two guests and the host setting the same blocks at once end the same everywhere;
  - an edit arriving while its column is being made lands. Breaking the replay on purpose made
    this test fail, as it should.
  - the round trip is timed, 0.1 s on a 0.05 s line.
- **Messages:** the new ones survive the network, 11 more kinds of junk are turned away, packed edits
  round-trip, and `checkChunk` refuses short, long, empty-run and unknown-block chunks.

## Step 3: players — built (2026-11-01)

**What changed:**
- **`net/playerState.ts`:** a player's state in 80 bytes (a `Float64Array` of 10):
  - the time on the host's clock;
  - position and look;
  - flying, crouching, swimming, on the ground;
  - the block held, arm swings so far, and the block being dug.

  States that don't make sense are refused: wrong size, NaN, beyond the world, no such block.
- **Sending them:** 20 a second each, on the unordered channel (`TUNING.net.stateRate`).
  - A guest sends its own once it knows the host's clock. It learns that NTP-style from its pings,
    taking the offset from the quickest of the last 16.
  - The host passes each guest's state on to the others, under the number of the link it came on,
    whatever the state says.
  - The host sends its own to everyone.
- **`net/remotePlayer.ts`, `RemotePlayer`:** someone else's states, turned into where to draw them.
  - Drawn 0.1 s behind, between the states either side, turning the short way.
  - Past the newest state, guessed on at the speed they were going for at most 0.25 s, then held.
  - A late or out-of-order state is dropped.
  - It counts the ground walked (for the legs), but not a jump of more than 8 blocks, and notices
    new arm swings.
- **The host checks guests' edits** (`editAllowed`):
  - within reach of the eye where the guest was last heard, plus 1.5 blocks of slack for the delay
    and half a block's diagonal;
  - a block you can't walk through not inside anyone, the host included.
  - A guest's break also takes away the torches the block held, as the host's own does.
- **The host keeps the land round each guest loaded** (`ChunkLoader.setOthers`): columns within 3
  chunks of each guest are generated (not meshed or drawn).
  - Their work is ordered by the distance from that guest.
  - They stay while the guest is within 3 + 2 chunks; when the guest leaves or moves on, they go.
  - So a guest far from the host can build, and step 4's mobs and water have land round them.
- **`render/playerRenderer.ts`:** others drawn as a blocky figure (invented): head with a face,
  body, two arms with hands, two legs.
  - The shirt is in the player's colour: the host red, then blue, green, yellow.
  - Legs and arms swing with the ground walked, the head tips where they look, the right arm swings
    when they dig or place, and crouching bends the body.
  - Drawn like the mobs: an InstancedMesh per part, lit by the world's light and the day's, fogged,
    the shader compiled at startup.
  - The name floats over the head, faint, seen through walls.
- **`?bot`** (`net/bot.ts`): the world opened to a test guest in the same page over the test network.
  - It walks a circle round where the host started.
  - Every 3 s it builds a plank beside its path or breaks the last one.
  - It's how to see other players without a second browser, and it runs the host side for real:
    states, edits checked and made, land kept, avatars.
- **Small changes:** `Player.crouching()` is public; every arm swing goes through the game's
  `swing()`, counted for the others. The mob texture helpers and the shaded box are exported for
  the avatar.

**Looked at in Chrome** (`?bot`, midday):
- the bot walks its circle with its name over it, blue shirted, legs and arms swinging mid-stride,
  facing the way it walks;
- its plank appears beside it and goes three seconds later, made on the host through the session
  (`?stats`: the last edit remeshed 2 chunks).
- 60 fps (the window on a 60 Hz screen today), no console errors.

**Not yet:** others' footsteps and digging sounds, and lines on screen when someone joins or leaves.
Both come with the game's guest side in step 5. The sessions already report who joins and leaves.

**Tests (10 new, 314 in all):**
- **States:** 80 bytes and back, and nonsense refused (also as a message).
- **`RemotePlayer`:**
  - drawn between states a moment ago, turning the short way through π;
  - guessed on past the newest for 0.25 s, then held;
  - late states dropped;
  - ground walked counted but not a jump across the map;
  - a new swing noticed when its state is reached.
- **Over the network:** with the guests' clocks 100 s off the host's, a guest's state reaches the
  host and the other guest, and the host's reaches both.
  - Stamped on the host's clock, the guest's clock within 20 ms after one ping.
  - Not echoed back.
  - Gone from everyone's lists when the guest leaves.
  - Numbers go by whose hello the host heard first. The first run of this test assumed otherwise,
    and jitter put the second guest first.
- **Edits:** allowed within reach and slack, not beyond, nor before the guest has been heard; a solid
  block refused inside anyone, a torch allowed.
- **The loader:** land round a guest 40 chunks away is loaded but not drawn, the host's own range
  stays, and it all goes when the guest leaves.

## Step 4: water, mobs, hits and time from the host — built (2026-11-01)

**What changed:**
- **Water:** each tick's changes go to every guest with the edits message, marked as water. Guests
  make them and remesh in the workers, as the host does; they don't run the water themselves.
  Blocks kept for a column a guest hasn't got are made the same way when it arrives.
- **`MobManager` round every player:**
  - `update` takes where every player is.
  - Each spawning try is round one of them, chosen at random when there are several, so one player
    alone spawns exactly as before. Never within the spawning distance of any.
  - A mob goes only when it's beyond 96 blocks of every player.
  - The cap is 24 for each player, 48 at most (`limit`, shown in `?stats`).
  - `byId` finds a mob for a guest's hit.
- **`net/mobState.ts`:** a mob in 52 bytes (13 float32s: number, kind, position, facing, what it's
  doing, velocity, on the ground, ground walked, time since hit) and a sound in 20. Nonsense refused.
- **`HostSession.shareMobs`,** 10 times a second (`TUNING.net.mobRate`):
  - each guest gets the mobs within 96 blocks of where it was last heard, on the unordered channel;
  - and the sounds made within hearing of it since last time, on the reliable one, so a puff is
    never lost.
- **`net/mobMirror.ts`, `MobMirror`:** a guest's mobs, as real `Mob`s.
  - Drawn 0.15 s behind, between the snapshots either side, turning the short way; held past the
    newest.
  - One missing from a snapshot has gone. An older snapshot is dropped.
  - The red flash after a hit fades on its own clock.
  - The renderer takes a `MobView` (the manager, or a mirror), and the crosshair's ray takes the
    mirror's mobs, so a guest draws and aims at mobs as the host does.
- **Hits:** a guest's hit goes to the host as a `hit`. The host makes it if the mob is within reach
  (with slack) of where the guest was last heard, knocked back away from the guest. The knockback,
  flash and puff come back with the mobs and sounds.
- **Time of day:** the host's, every 2 s (`TUNING.net.timeEvery`), and in the welcome.
- **The host game (`?bot`):** mobs live round the bot too, mob sounds and the water go out, the time
  goes out, and guests' hits are checked and made.

**Looked at in Chrome** (`?bot`, mobs on): 48 mobs round the host and the bot ("48 of 48" after
fixing the line, which had shown the cap for one), 0.2–0.3 ms a frame for all of them, no console
errors. A guest's view of mobs and water needs the guest's game, step 5.

**Tests (8 new, 322 in all):**
- **Mobs on the wire:** they round-trip (104 bytes for two), and nonsense is refused.
- **Two players 200 blocks apart:**
  - mobs spawn round both, never within spawning distance of either;
  - the cap doubles with two, and stays doubled with three;
  - a mob near one player stays while that player does.
- **The mirror:**
  - between snapshots, the short way round, with the kind's own body;
  - an older snapshot dropped, a mob left out gone, held past the newest;
  - the red flash fades as on the host.
- **Over the network:**
  - a guest gets only the mobs near it, and only the sounds it can hear;
  - its hit reaches the host's game;
  - water edits are marked as water and others not;
  - the time arrives in the welcome and after.

## Step 5: the menus, and a guest's game — built (2026-11-01)

**What changed:**
- **Opening a world to friends** (the pause menu's "Open to friends"):
  - a name (kept in the settings), then a four-letter code from the PeerJS server;
  - the menu shows the code and who's in, and "Close to friends" sends everyone home;
  - quitting closes it too.
  - Any world can be opened, saved or not. The host's name is the setting's.
- **Joining** (the world list's "Join a friend", also offered when there are no worlds yet):
  - a code and a name; the page loads again with `?join=<code>`.
  - The game connects before making anything, says hello, and on the welcome makes the world from
    the host's seed and time, as "<host>'s world", unsaved, starting where the host stands.
  - Failing (no such code, full, another version, no network), it goes back to the world list,
    which says why.
- **A guest's game:**
  - edited chunks come from the host (`RemoteSaves` as the loader's saves);
  - its edits show at once and go to the host;
  - the host's edits are made as they come: others' remeshed at once and heard where they are
    (break and place sounds), water in the workers;
  - it runs no water and no mobs of its own: the host's mobs are drawn from the mirror and aimed at
    as before, and a hit goes to the host;
  - mob sounds and puffs come from the host, and the time of day is the host's.
  - Pausing doesn't stop the world.
  - "Leave" goes back to the world list. When the host closes or leaves, or the line goes quiet,
    the guest goes back to the list with the reason.
- **While playing together nothing pauses:** water, mobs and time go on when the host (or a guest)
  has the pause menu up. The player stands still.
- **On screen:** a line for a few seconds when someone joins or leaves, or a problem with the room.
- **`?stats`:** a `net` line:
  - who (hosting with the code and how many are in, or in whose world, with the round trip);
  - KB a second out and in, and messages a second (`net/traffic.ts`, which counts by wrapping the
    links).
- **PeerJS is loaded only when hosting or joining** (its own 90 KB chunk, 24 KB gzipped). Playing
  alone downloads nothing more.
- **Two fixes found trying it:**
  - "Join a friend" was only on the list of worlds, not on the new-world screen that comes up when
    there are none; it's on both now.
  - The reason a game ended didn't show on that screen either. It shows on whichever screen comes
    first, once, and is taken out of the address.

**Tried in Chrome, over the real PeerJS server:**
- **Two tabs first** (a hidden tab stops drawing, but handles messages):
  - The host opened to friends: code XLPH.
  - The second tab joined from the world list as "Guesty": "Hosty's world", "Here: Hosty, Guesty",
    the land loaded, standing where the host stood.
  - The guest walked away and placed a plank. The host made it ("last edit… 1 chunks remeshed") and
    showed Guesty, blue, looking down beside it.
  - Network lines: the guest's round trip 2 ms; the host 20.3 KB/s out (mostly 48 mobs, 10 times a
    second) and 1.7 KB/s in.
  - Leave: the host got "Guesty left.". The guest joined again and the host closed: the guest
    landed on the world list with "The host closed the world."
- **Then side by side**, the host in your Chrome window and the guest (as "Player") in the app's
  built-in browser, both drawing at 60 fps:
  - the guest heard 31.4 KB/s and sent 1.7 KB/s, round trip 3 ms, with 48 mobs near it;
  - from the guest's screen the host stood facing it, red shirt, face and name, then walked off
    when the host walked.
  - The extension can't drive a tab dragged into a window of its own, hence the built-in browser
    for the guest.
- **Not tried live yet:** water flowing on a guest's screen, mobs seen up close on a guest, a guest
  flying far from the host, and frame times with both busy. Those are for step 6, with the
  measurements.
- **Not done:** others' footsteps and digging sounds (their breaks and places are heard).

**Tests (2 new, 324 in all):** `bytesOf` sizes messages; a room's guests' traffic is counted both
ways per second, and messages still reach their handlers. The settings test now covers names
(tidied; the default when there's none or nothing left).
