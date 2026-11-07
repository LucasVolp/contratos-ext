import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  freshnessLine,
  staleUnitLine,
  type SyncState,
} from "@/lib/contracts-api";

/** States where the listed contracts come from and how fresh they are, unit by unit. */
export function SyncNotice({
  sync,
  showLine = true,
}: {
  sync: SyncState;
  /** False when the first-load notice already fills the empty list. */
  showLine?: boolean;
}) {
  return (
    <div className="sync-notice">
      {showLine && (
        <p>
          <RefreshCw size={14} aria-hidden="true" />
          {freshnessLine(sync)}
        </p>
      )}
      {sync.staleUnits.length > 0 && (
        <ul>
          {sync.staleUnits.map((unit) => (
            <li key={unit.uasg}>
              <AlertTriangle size={14} aria-hidden="true" />
              {staleUnitLine(unit)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
