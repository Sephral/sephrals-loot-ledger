# Sephral’s Loot Ledger: Manual

## The window

Open the Loot Ledger from the token controls on the left (scroll icon) or with the button above the actor directory. It has four tabs:

* **Party inventory:** everything the group owns together, the party fund and, below it, what your character carries. *Take* moves an item to your character, *Put in* moves it into the party inventory, the hand icon gives it to another character. You can also drag items from your character sheet onto the party inventory.
* **Loot:** what waits to be handed out. Mark *Need*, *Want* or *Pass* for your character, everybody sees who marked what. The GM collects loot from a fight, adds items and coins, splits the coins and hands everything out.
* **Log:** every change, newest first, with who asked for it. The line on top shows whether the log is unchanged.
* **Balance:** what each character took from the loot, the party inventory and the party fund, minus what they put in, today and in total.

Click the picture or the name of an item to open its sheet, for example to read what a piece of loot does before you claim it. Players see the items of the party inventory and the loot read only. In D&D 5e, unidentified items show only their unidentified name and description.

If you play more than one character, pick the one you act for at the top. The gear in the title bar opens the module's settings.

The loot table, the party fund and the balance can be switched off in the settings. With all three off the Loot Ledger is a plain party inventory with a log. A part that is switched off stays visible while it still holds something: leftover loot can be handed out or moved into the party inventory, and coins left in the party fund can still be taken out.

## For the GM

* **Collect from the fight:** when a combat ends, the module asks what the defeated leave behind (items and coins). The button on the Loot tab does the same for the running or the last fight. With the loot table switched off nothing is offered after a fight. The button then sits on the Party inventory tab and collects straight into the party inventory, coins into the party fund.
* **Add loot:** drag items from any sheet, the sidebar, a compendium or a loot link onto the Loot tab. Items from a sheet move, everything else is copied.
* **Hand out:** *Hand out* gives every claimed item to a character, following the rule in the settings, and moves the loot nobody wants into the party inventory. *Rest to the party inventory* does only the second part. You can also pick a character per item and give it directly.
* **Coins:** *Split* shares the coins of the loot among the characters you pick. Coins can be added to the loot or the party fund, and the party fund can pay for things (an inn, a ferry, a bribe).
* **Hand out from the party inventory:** the gift icon next to an item of the party inventory gives it to a character of your choice.
* **Approvals:** requests that need your approval appear on top of the window and as a chat message only you see.
* **Undo:** most log entries can be reversed with the arrow button. Items and coins go back where they came from, and the log records the undo.

## Settings

All options are in *Game Settings → Configure Settings → Sephral’s Loot Ledger*:

| Setting | What it does |
| --- | --- |
| Module language | Follow Foundry, German or English, for you |
| Loot table | Claims and handing out of loot. Off: no Loot tab, nothing is collected after a fight, the GM collects by hand into the party inventory |
| Party fund | Shared coins of the group. Off: coins stay with the characters |
| Balance tab | Shows the Balance tab |
| Who shares the loot | The system's party (Crucible and D&D 5e), otherwise all player characters, or always all player characters |
| Taking from the party inventory | Free, or with the GM's approval. Putting things in is always free |
| Party fund limit | Up to this amount players take coins without asking, more needs approval. 0 means always ask (only with the party fund) |
| Gifts must be accepted | The receiving player accepts or declines a gift first |
| How loot is handed out | Fair (strongest claim, then who received the least), roll (strongest claim, then the highest roll), or the GM decides (only with the loot table) |
| Rest of a coin split | Into the party fund, or it stays in the loot (only with the loot table and the party fund) |
| Offer to collect after a fight | Ask the GM when a combat ends (only with the loot table) |
| Chat messages | For everyone, only for the GM, or none |
| Self test | Checks the party inventory, the log and the system support (GM) |
| Coin values | D&D 5e only: what each coin is worth in copper, for tables with their own exchange rates (GM) |

Settings that belong to a switched off part are hidden in the settings dialog.

## Who can do what

* **Players** act for the characters they own. They put things into the party inventory, take things out, pay into the party fund, take coins up to the limit, give items to other characters and claim loot.
* **The GM** does all of that for every character and manages the loot.
* The party inventory is an actor everyone may look at but nobody but the GM may change, and the loot log is a journal everyone may read. Please keep it that way: a player who owns the party inventory actor could change it past the log. The self test warns about this.
* Every change runs on the client of the active GM. Without a GM online, the window still shows everything, but nothing can change hands.

## The log

The log lives in the journal *Loot log*, one page per day, readable even without the module. Each entry records the time, who asked for it, what moved where and its value. The Loot Ledger also notices when the party inventory is changed directly, for example by dragging an item onto its sheet, and logs that as a change outside the module. If anybody edits the log afterwards, the line on top of the Log tab and the self test show which entry was changed.

## Game systems

* **Crucible:** coins are the hero's coins. Equipped and invested gear is taken off when it changes hands. Equipped gear cannot be handed over during a fight (unequipping costs action points there), and cursed invested items only by the GM. Natural weapons and armor stay with their creature, and adversary gear stops scaling with the owner's level once a hero owns it.
* **D&D 5e:** coins stay separate (pp, gp, ep, sp, cp). Shares of a split are paid in gold, silver and copper. The module exchanges coins at the rates of the system. Tables with their own rates, for example 100 copper to a silver and 100 silver to a gold, set them under *Coin values*. Only the values that differ from the system are stored, and coins already in the loot or the party fund keep their worth in copper. Equipped and attuned items are taken off, also inside containers, and containers move with their contents. The window lists what a container holds, and its value includes the contents. Unidentified items keep their unidentified name in the window and the log.
* **Other systems:** the module works with any system whose items have a quantity. In the module settings the GM names the actor type of player characters, where items keep their quantity and price and where characters keep their coins (one number). Without a coin path the coin features stay off. The self test tells whether the paths fit.

Other modules can add support for more systems through the module's API.

## API

`game.modules.get("sephrals-loot-ledger").api` offers:

| Function | What it does |
| --- | --- |
| `open({tab})` | Opens the window, optionally on `"stash"`, `"pool"`, `"log"` or `"balance"` |
| `collect()` | Opens the dialog which collects the loot of the last fight (GM) |
| `entries()` | All log entries in order |
| `verify()` | Checks the log for later changes |
| `ledgerActor()` | The actor which holds the loot and the party inventory |
| `registerAdapter(systemId, adapter)` | Adds support for another system, see `BaseAdapter` |
| `runSelfTest()` | Runs the self test (GM) |

## Limits

* A GM has to be online for every change.
* Items with a quantity of zero, spells, features and similar things that are not physical items cannot be handed over.
* Only player characters can claim loot. Everybody else is a source of loot, not a recipient.
