"use client";

import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import { useOfflineStatus } from "@/hooks/useOfflineStatus";
import {
  isOfflineEnabled,
  setOfflineEnabled,
} from "@/lib/offline/settings";

/**
 * Settings tab for the offline feature flag and live status readout.
 *
 * The toggle writes straight to localStorage via setOfflineEnabled(); the
 * OfflineProvider's fetch patch is installed unconditionally so no reload
 * is needed — the next fetch already sees the new flag.
 *
 * Phase 1 (current): GETs on /api/events and /api/feeds are mirrored into
 * IndexedDB, and served from IDB when the network is unreachable. You can
 * open the calendar offline and see your events.
 *
 * Phase 2 (planned): writes (create/update/delete) go into a pending-
 * writes queue in IDB, flushed back to the server when the connection
 * returns. Last-writer-wins: your local edit beats whatever the server
 * has, even if someone else edited the same event in the meantime.
 */
export function OfflineSettings() {
  const [enabled, setEnabled] = useState(false);
  const { online, pendingCount } = useOfflineStatus();

  useEffect(() => {
    setEnabled(isOfflineEnabled());
  }, []);

  const handleToggle = (next: boolean) => {
    setEnabled(next);
    setOfflineEnabled(next);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Offline</h2>
        <p className="text-sm text-muted-foreground">
          Kalender auch ohne Netz anzeigen. Aenderungen werden offline zwischengespeichert
          und beim naechsten Online-Gehen hochgeladen (Phase 2, in Arbeit).
        </p>
      </div>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="offline-toggle" className="text-base font-semibold">
              Offline-Modus aktivieren
            </Label>
            <p className="text-sm text-muted-foreground">
              Gelesene Events werden lokal im Browser gespeichert und stehen offline zur Verfuegung.
            </p>
          </div>
          <Switch
            id="offline-toggle"
            checked={enabled}
            onCheckedChange={handleToggle}
          />
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="mb-4 text-base font-semibold">Status</h3>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Feature-Flag</dt>
            <dd className="font-medium">{enabled ? "An" : "Aus"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Verbindung</dt>
            <dd className="font-medium">{online ? "Online" : "Offline"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Pending Writes</dt>
            <dd className="font-medium">{pendingCount}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">IndexedDB</dt>
            <dd className="font-medium">
              {typeof indexedDB !== "undefined" ? "Verfuegbar" : "Nicht verfuegbar"}
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
