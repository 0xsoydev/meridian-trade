"use client";

import { IDKitRequestWidget, proofOfHuman, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type ApprovalConfig = {
  app_id: `app_${string}`;
  action: string;
  environment: string;
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

export default function ApprovePage() {
  const params = useParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [config, setConfig] = useState<ApprovalConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const preset = useMemo(() => proofOfHuman({ signal: id ?? "" }), [id]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    fetch(`/api/v1/approvals/${id}/rp-signature`, { method: "POST" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return (await response.json()) as RpSignatureResponse;
      })
      .then((body) => {
        if (!active || !body.app_id) return;
        setConfig({
          app_id: body.app_id as `app_${string}`,
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

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-6">
          <p className="text-sm break-words text-red-400">{error}</p>
        </div>
      </main>
    );
  }

  if (!config) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-zinc-400">Loading approval…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-2xl font-semibold">Approve this action</h1>
        <p className="text-sm text-zinc-400">
          This approval is bound to this request. Verify with the World App to continue.
        </p>
        <button
          className="w-full rounded-full bg-emerald-400 px-4 py-3 text-sm font-semibold text-zinc-950 disabled:opacity-50"
          disabled={approved}
          onClick={() => setOpen(true)}
          type="button"
        >
          {approved ? "Approved" : "Verify with World ID"}
        </button>
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={config.app_id}
          action={config.action}
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
      </div>
    </main>
  );
}
