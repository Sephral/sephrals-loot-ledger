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
* **Roll a table:** roll loot on a roll table, look at it first and add it in one step, see [Loot from roll tables](#loot-from-roll-tables).
* **Item Piles:** take what an item pile holds into the loot, or leave unwanted loot as a new pile, see [Item Piles](#item-piles).

## Loot from roll tables

The GM rolls loot from the context menu of a roll table in the sidebar or a compendium (*Roll loot*), from the table's window (*Roll loot* in its menu) or with *Roll a table* on the Loot tab. A preview window shows what was drawn:

* **Items** come with their quantity. Change a quantity in its field, 0 leaves the item out.
* **Coins:** text results that are only coins, like `3d6 gp`, `2d4 × 10 gp` or `50 gp, 3 sp`, become coins. The module knows the coins of the system by key and abbreviation.
* **Other tables:** a result that is another table is drawn there, as often as its quantity says.
* **Everything else** (texts, actors, journals) is shown but stays out.

The arrow button of a line draws that line again from the table it came from, *Roll again* draws everything again, *Draws* sets how often the table is drawn (a number or a formula). The checkbox leaves a line out. *Into the loot* adds the rest in one step, the log notes the table. Items are copied, the table and its items stay as they are. With the loot table switched off, everything goes into the party inventory and the coins into the party fund.

**Quantities:** every table result can carry a quantity, a number or a formula like `2d4`. Set it in the table's edit mode (the field below each result) or in the result's own editor (*Quantity (Loot Ledger)*). For an item it is how many, for another table how often it is drawn, for a coin text how often the coins count. Empty means 1. A formula that cannot be rolled counts as 1 and is marked in the preview.

The preview does not mark results as drawn, so tables without replacement keep all their results.

## Item Piles

With the module [Item Piles](https://foundryvtt.com/packages/item-piles) active, the GM can move loot between piles and the Loot Ledger. Item Piles takes and gives everything itself, so its own rules keep working, for example that an empty pile disappears. In D&D 5e Item Piles needs its companion *Item Piles: D&D 5e*.

* **Take from a pile:** the token controls of a pile (right click on the token) have a scroll button. The Loot tab has *From item piles*, which lists all piles and containers on the scene you look at. Pick the items and the coins, and they move into the loot, with the loot table switched off into the party inventory and the party fund. Merchants and vaults are left alone, and so is what Item Piles hides from looting, like spells.
* **Coins:** the coins of a pile count when they match a coin of the system. Coins the module cannot count, for example a secondary currency, stay in the pile and the dialog names them.
* **Undo:** taking from a pile can be undone while the pile still exists. Items go back into the pile, coins onto its actor. Containers cannot go back.
* **Leave as item pile:** the button on the Loot tab puts the loot nobody claimed into a new pile next to the selected token, or in the middle of the view. Coins stay in the loot. This cannot be undone from the log. Take the pile back instead.

Piles never count as characters, even where Item Piles builds them from the character type.

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
| Debug file | Saves a file for bug reports, see [Debug file](#debug-file) (GM) |
| Coin values | D&D 5e only: what each coin is worth in copper, for tables with their own exchange rates (GM) |

Settings that belong to a switched off part are hidden in the settings dialog.

## Usage statistics

The module can take part in a small usage report shared by all of Sephral’s modules. Nothing is counted or sent until the GM agrees: shortly after the world starts, the active GM is asked, and the question comes back at every start until there is an answer. The answer counts for all of Sephral’s modules in the world. *Share usage statistics* in the module settings turns the report on or off at any time, and *Manage statistics* below it shows what the report contains right now.

With the GM’s consent only the active GM’s browser counts, and it sends at most one report a day. The counts are kept in a hidden world setting, so all browsers and computers of the GM count together, and turning the statistics off deletes them. A copy of a world gets its own world ID. The question lists everything the report contains, from the Foundry version to a random world ID. For the Loot Ledger it holds:

* on how many of the last 30 days the module was used
* how often loot is claimed and handed out, coins are split, items move between a character and the party inventory, items are given to other characters, coins go into or out of the party fund, loot is collected after a fight, log entries are undone, loot is taken from item piles or left as an item pile, and loot rolled on a table is added
* the settings *Loot table*, *Party fund* and *How loot is handed out* (only the chosen option)
* where errors occur in the module code: file, line and error type, never the error message

No names, chat messages, notes, dice results or other content of the world are sent.

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
| `rollLoot(table)` | Rolls loot on a roll table (the table or its UUID) in the preview window (GM) |
| `takeFromPiles(uuids)` | Opens the dialog which takes the contents of item piles into the loot, without UUIDs the piles of the current scene (GM, Item Piles) |
| `dropLeftovers()` | Leaves the loot nobody claimed as a new item pile on the scene (GM, Item Piles) |
| `entries()` | All log entries in order |
| `verify()` | Checks the log for later changes |
| `ledgerActor()` | The actor which holds the loot and the party inventory |
| `registerAdapter(systemId, adapter)` | Adds support for another system, see `BaseAdapter` |
| `runSelfTest()` | Runs the self test (GM) |
| `saveDebugFile(messageId)` | Saves a debug file about one chat message, or without an id about the latest ones (GM) |

## Debug file

For bug reports the GM can save a debug file, one file for all of Sephral’s modules in the world: in the settings with *Save debug file*, or for a single Loot Ledger message with *Save Debug File (Sephral’s Modules)* in its context menu in the chat. For the Loot Ledger it holds:

* the versions of Foundry, the system and the module, and the active modules,
* the settings of the Loot Ledger, including the open approvals and offers,
* how requests reach the GM (query or chat message) and the state of the ledger: the party inventory actor and log journal, the coins, the loot with its claims, the open requests and the check of the log,
* the Loot Ledger messages among the latest 50 chat messages, or the one message, with what each one refers to and whether its request is still open,
* the recent requests to the GM this browser sent or handled: action, way, result and duration. Item data and notes are left out, only ids and sizes are kept.

The file contains chat text and whispers. Check it before you share it.

## Limits

* A GM has to be online for every change.
* Items with a quantity of zero, spells, features and similar things that are not physical items cannot be handed over.
* Only player characters can claim loot. Everybody else is a source of loot, not a recipient.
