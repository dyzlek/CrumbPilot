# CrumbPilot

![CrumbPilot thumbnail: a cat at the wheel](thumbnail.png)

CrumbPilot is a Cookie Clicker Steam mod by **Moxolote**. It handles repetitive clicking and purchases, and lets you build your own automation in a visual, block-based Script Studio.

The thumbnail is a cat driving. The cat is not responsible for your cookie economy.

## What it does

| Feature | Control |
| --- | --- |
| Big cookie autoclick | Enable or disable it independently; set the speed from **0 to 1,000 clicks per second**. |
| Golden cookies | Detect and pop them automatically when enabled. |
| Wrath cookies | Separate switch; off by default. |
| Buildings | Buy affordable buildings on a custom interval. |
| Upgrades | Buy affordable regular upgrades on a separate interval. Toggle and special-pool upgrades are skipped. |
| Script Studio | Create, name, copy, delete, edit, and run up to 20 visual scripts. Multiple scripts can run at once. |

The building and upgrade intervals are set independently from **1 second to 24 hours**. The small control panel can be moved or minimized; the **CP** button in the upper-left corner opens it again. Statistics show clicks, detected and popped cookies, and purchases.

## Install on Steam

1. Download this repository as a ZIP from GitHub and extract it.
2. Put the folder containing `info.txt`, `main.js`, and `thumbnail.png` in Cookie Clicker's `resources/app/mods/local/` directory. A typical Windows path is `C:\Program Files (x86)\Steam\steamapps\common\Cookie Clicker\resources\app\mods\local\CrumbPilot\`.
3. Start or restart Cookie Clicker and enable **CrumbPilot** in the game's Mods menu if needed.

The folder name can differ. Keep the three mod files together at the top level of that folder. Do not place an extra copy of this mod beside an older one: both would use the same internal mod ID.

If you already use the local **Car Clicker** mod, update its existing folder with the new `main.js`, `info.txt`, and `thumbnail.png`. The internal ID remains `Car Clicker` so existing mod settings can be loaded after the visible rename to CrumbPilot.

Steam Workshop subscribers receive updates through Steam after the Workshop item is updated. GitHub changes alone do not update a Workshop item. The game's [official Workshop guide](https://orteil.dashnet.org/cookieclickerworkshop.html) describes the local mod folder and the in-game **Options → Publish mods** screen used for publishing and updating a mod.

## Quick start

- Use the **Big cookie autoclick** switch and the speed slider for normal clicking. Setting the speed to `0 CPS` leaves golden-cookie and wrath-cookie switches independent.
- Turn on **Golden cookies** or **Wrath cookies** separately.
- Turn on **Buildings** and/or **Upgrades**, then enter how many seconds to wait between purchase checks. The two timers are independent.
- Click **Open Script Studio** to build a custom automation.

`Alt+E` toggles big-cookie autoclick. `F7` stops big-cookie autoclick. These shortcuts do not stop your other enabled features or running scripts; use each feature's control to stop it.

## Script Studio

Each script has a name, its own block list, and its own **Run this script** button. Click **+ New** to make a script or **Copy** to duplicate one. Select a script in the left column to edit it. Scripts are saved with your game, but they start paused after the game restarts.

Choose a block from the palette. To insert a block at a specific point, select an existing block first; the new block appears after it. Move blocks with the dotted drag handle or the up/down buttons. You can duplicate or delete an individual block. Editing a running script stops that script so the changed sequence can be checked before you run it again.

| Block | Behavior |
| --- | --- |
| **Building** | Buys one affordable building. Choose the cheapest available building or a specific building. |
| **Upgrade** | Buys the cheapest affordable regular upgrade. Special and toggle upgrades are excluded. |
| **Wait** | Pauses this script for the selected number of seconds. |
| **If / Else** | Adds a ready-to-edit `If`, `Else`, and `End if` group. Compare your current cookies or cookies per second to a number. |
| **Repeat** | Goes back to the first block. Add a Wait block to control how often the script repeats. |

Example: to buy one building every 30 seconds, create a script with these blocks in order:

```text
Buy building → cheapest
Wait → 30 seconds
Repeat from start
```

Example: to buy an upgrade only when you have at least one million cookies:

```text
If → cookies ≥ 1,000,000
  Buy cheapest upgrade
Else
  Wait → 15 seconds
End if
Repeat from start
```

An `If` group must keep a matching `End if`. The status line below the blocks shows an error if the sequence is incomplete. Scripts without a Repeat block stop after their last block. A rapidly repeating script is throttled to avoid locking up the game.

The regular auto-buy switches and Script Studio scripts are independent. If both are running, both can spend your cookies.

## Saves, compatibility, and limits

- Your switches, intervals, scripts, script names, and statistics are saved with Cookie Clicker's mod save data. Running scripts resume **paused** after a game restart.
- The internal mod ID is still `Car Clicker`. This preserves compatibility with earlier saves; it is not the visible name of the mod.
- This mod calls Cookie Clicker's own game functions. The game must be running for it to work. Behavior while the Steam window is minimized depends on how the game handles background execution.
- `AllowSteamAchievs` is set to `0`, so enabling the mod blocks new Steam achievements as described in the [official mod guide](https://orteil.dashnet.org/cookieclickerworkshop.html).
- The mod was packaged for Cookie Clicker **2.053**. Check compatibility after major game updates.

## Files

- `main.js` — mod logic and user interface.
- `info.txt` — Cookie Clicker mod metadata.
- `thumbnail.png` — mod thumbnail.

Made by **Moxolote**.
