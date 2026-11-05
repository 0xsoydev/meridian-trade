"use client";

import { IDKitRequestWidget, proofOfHuman, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type ApprovalConfig = {
  app_id: `app_${string}`;
  action: string;
  environment: "production" | "staging" | "sandbox";
  rp_context: RpContext;
};

type RpSignatureResponse = {
  sig: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  rp_id: string;
  app_id: string | null;
  environment: string;
  action: string;
};

const WORLD_BYPASS = process.env.NEXT_PUBLIC_WORLD_BYPASS === "true" && process.env.NODE_ENV !== "production";

function isAppId(value: string): value is `app_${string}` {
  return value.startsWith("app_");
}

function isEnvironment(value: string): value is ApprovalConfig["environment"] {
  return value === "production" || value === "staging" || value === "sandbox";
}

export default function ApprovePage() {
  const params = useParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [config, setConfig] = useState<ApprovalConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [denied, setDenied] = useState(false);
  const preset = useMemo(() => proofOfHuman({ signal: id ?? "" }), [id]);

  useEffect(() => {
    if (!id || WORLD_BYPASS) return;
    let active = true;
    fetch(`/api/v1/approvals/${id}/rp-signature`, { method: "POST" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return (await response.json()) as RpSignatureResponse;
      })
      .then((body) => {
        if (!active || !body.app_id || !isAppId(body.app_id) || !isEnvironment(body.environment)) return;
        setConfig({
          app_id: body.app_id,
          action: body.action,
          environment: body.environment,
          rp_context: {
            rp_id: body.rp_id,
            nonce: body.nonce,
            created_at: body.created_at,
            expires_at: body.expires_at,
            signature: body.sig,
          },
        });
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "could not load this approval");
      });
    return () => {
      active = false;
    };
  }, [id]);

  const verify = useCallback(
    async (result: IDKitResult): Promise<void> => {
      const response = await fetch(`/api/v1/approvals/${id}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idkit: result }),
      });
      if (!response.ok) throw new Error(await response.text());
    },
    [id],
  );

  const approveWithoutWorld = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`/api/v1/approvals/${id}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idkit: {} }),
      });
      if (!response.ok) throw new Error(await response.text());
      setApproved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "could not approve this request");
    }
  }, [id]);

  const deny = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(`/api/v1/approvals/${id}/deny`, { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      setDenied(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "could not deny this approval");
    }
  }, [id]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-6">
          <p className="text-sm break-words text-red-400">{error}</p>
        </div>
      </main>
    );
  }

  if (!config && !WORLD_BYPASS) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-zinc-400">Loading approval…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-2xl font-semibold">
          {approved ? "Approved" : denied ? "Denied" : "Approve this action"}
        </h1>
        <p className="text-sm text-zinc-400">
          {approved
            ? "The request may continue."
            : denied
              ? "The request was refused and cannot be reused."
              : WORLD_BYPASS
                ? "Test bypass on: this approves without the World App."
                : "This approval is bound to this request. Verify with the World App to continue."}
        </p>
        <button
          className="w-full rounded-full bg-emerald-400 px-4 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-50"
          disabled={approved || denied}
          onClick={() => {
            if (WORLD_BYPASS) void approveWithoutWorld();
            else setOpen(true);
          }}
          type="button"
        >
          {WORLD_BYPASS ? "Approve (World ID test bypass)" : "Verify with World ID"}
        </button>
        <button
          className="w-full rounded-full border border-white/15 px-4 py-3 text-sm font-semibold text-zinc-300 disabled:opacity-50"
          disabled={approved || denied}
          onClick={deny}
          type="button"
        >
          Deny this request
        </button>
        {config ? (
          <IDKitRequestWidget
            open={open}
            onOpenChange={setOpen}
            app_id={config.app_id}
            action={config.action}
            environment={config.environment}
            rp_context={config.rp_context}
            allow_legacy_proofs
            preset={preset}
            handleVerify={verify}
            onSuccess={() => {
              setApproved(true);
              setOpen(false);
            }}
            onError={(code) => setError(String(code))}
          />
        ) : null}
      </div>
    </main>
  );
}
