## Changelog

### 2025-10-13

#### Added
- Commissions page (`index.html` → `#commissions-page`) with spreadsheet-style table:
  - Add commission entries (date, amount ±, note)
  - Inline edit/save and delete per row
  - CSV export button
  - Bulk percentage adjustment (positive/negative) across all rows
- Navigation wiring:
  - From Dashboard → Commissions (`#commissionsBtn`)
  - Back to Dashboard from Commissions

#### Data / Firestore
- New collection: `commissions`
  - Fields per document: `date` (ISO string), `amount` (number, ± allowed), `note` (string), `createdAt`/`updatedAt` (server timestamps)
- Continued usage of existing:
  - `funds/total` document for AUM aggregate
  - `funds/total/transactions` for profit/loss events (Buy = profit +€, Sell = loss -€)
  - `funds/total/aumHistory` for AUM valuation checkpoints

#### Changed
- Redesigned “fund points” to true performance using time-weighted return (TWR):
  - Neutralizes external flows by using AUM history as valuation periods
  - For each period between AUM snapshots, period return r = profit_in_period / starting_AUM
  - Cumulative performance = Π(1 + r) − 1
  - Charts updated to plot cumulative performance (%) over time
  - Top-of-dashboard text now shows `Performance: X%` (previous AUM text hidden)

#### UI/UX
- Dashboard
  - Removed/hid the textual AUM summary at the top (the AUM chart remains as-is)
  - Added Commissions button
- Commissions
  - Inputs constrained (date max today; amount ± up to 1,000,000,000)
  - Basic input sanitization for notes
  - Table with Save/Delete actions

#### Implementation Details
- Files updated:
  - `index.html`: Added Commissions page markup, buttons, and table
  - `app.js`:
    - Navigation handlers for Commissions
    - Firestore CRUD for `commissions`
    - CSV export and bulk adjust logic
    - Performance computation:
      - Introduced helpers to compute TWR series from `aumHistory` + transactions
      - Updated dashboard and public charts to plot cumulative % performance
      - Replaced old points display with performance percentage

#### Notes & Assumptions
- Profit/loss events are the existing Buy/Sell transactions in `funds/total/transactions`:
  - Buy = realized profit (+)
  - Sell = realized loss (−)
- Accuracy of TWR depends on maintaining sufficient `aumHistory` snapshots to bracket profit/loss activity.
- AUM chart logic not modified; only the textual AUM summary was hidden.


