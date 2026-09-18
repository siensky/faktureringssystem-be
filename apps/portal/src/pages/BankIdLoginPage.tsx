import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as bankidApi from "../api/bankid";
import { useAuth } from "../auth/AuthContext";
import { computeQrCode } from "../lib/bankidQr";

// Samma kadens som services/auth/src/bankid/routes.ts:s kommentar anger:
// collect() pollas var ~2:a sekund. QR-koden räknas om lokalt var 1:a
// sekund (BankIDs egen algoritm, se lib/bankidQr.ts) — separat intervall
// eftersom den inte kräver ett nätverksanrop.
const COLLECT_POLL_MS = 2000;
const QR_REFRESH_MS = 1000;

type ViewState =
  | { kind: "starting" }
  | {
      kind: "pending";
      orderRef: string;
      autoStartToken: string;
      qrStartToken: string;
      qrStartSecret: string;
      qrStartedAt: Date;
      hintCode?: string;
    }
  | { kind: "failed"; message: string };

export function BankIdLoginPage() {
  const { loginWithBankId } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<ViewState>({ kind: "starting" });
  const [qrCode, setQrCode] = useState<string | null>(null);
  // StrictMode kör effekter två gånger i dev — en ref stoppar en dubbel
  // init() (samma sorts skydd som AuthContext.tsx:s hasAttemptedRefresh).
  const hasStarted = useRef(false);

  const start = useCallback(async () => {
    setView({ kind: "starting" });
    setQrCode(null);
    try {
      const result = await bankidApi.init();
      setView({
        kind: "pending",
        orderRef: result.orderRef,
        autoStartToken: result.autoStartToken,
        qrStartToken: result.qrStartToken,
        qrStartSecret: result.qrStartSecret,
        qrStartedAt: new Date(result.qrStartedAt),
      });
    } catch (err) {
      setView({
        kind: "failed",
        message: err instanceof Error ? err.message : "Kunde inte starta BankID-inloggningen",
      });
    }
  }, []);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    void start();
  }, [start]);

  // Poll collect() medan en order är öppen. Körs om vid varje hintCode-
  // uppdatering också (view ändras då) — ofarligt, det nya intervallet
  // hinner ändå fram till ungefär samma tidpunkt som det gamla skulle ha
  // gjort, eftersom omstarten sker precis när föregående poll svarade.
  useEffect(() => {
    if (view.kind !== "pending") return;
    const { orderRef } = view;
    let cancelled = false;

    const interval = setInterval(async () => {
      try {
        const result = await bankidApi.collect(orderRef);
        if (cancelled) return;

        if (result.status === "complete") {
          clearInterval(interval);
          await loginWithBankId(result);
          navigate(result.companies.length > 1 ? "/companies" : "/", { replace: true });
          return;
        }
        if (result.status === "failed") {
          clearInterval(interval);
          setView({ kind: "failed", message: "Signeringen avbröts eller gick ut. Försök igen." });
          return;
        }
        setView((prev) =>
          prev.kind === "pending" ? { ...prev, hintCode: result.hintCode } : prev,
        );
      } catch (err) {
        if (cancelled) return;
        clearInterval(interval);
        setView({
          kind: "failed",
          message: err instanceof Error ? err.message : "Något gick fel",
        });
      }
    }, COLLECT_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [view, navigate, loginWithBankId]);

  // Räkna om QR-koden lokalt var 1:a sekund — inget nätverksanrop.
  useEffect(() => {
    if (view.kind !== "pending") {
      setQrCode(null);
      return;
    }
    const { qrStartToken, qrStartSecret, qrStartedAt } = view;
    let cancelled = false;

    async function refresh() {
      const code = await computeQrCode(qrStartToken, qrStartSecret, qrStartedAt);
      if (!cancelled) setQrCode(code);
    }
    void refresh();
    const interval = setInterval(() => void refresh(), QR_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [view]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="mb-6 text-xl font-semibold">Logga in med BankID</h1>

        {view.kind === "starting" && <p className="text-slate-500">Startar…</p>}

        {view.kind === "pending" && (
          <>
            <div className="mb-4 flex justify-center">
              {qrCode ? (
                <QRCodeSVG value={qrCode} size={220} />
              ) : (
                <div className="flex h-[220px] w-[220px] items-center justify-center text-slate-400">
                  Laddar QR-kod…
                </div>
              )}
            </div>
            <p className="mb-4 text-sm text-slate-500">
              Skanna QR-koden med BankID-appen på en annan enhet, eller öppna BankID direkt på den
              här enheten:
            </p>
            <a
              href={`bankid:///?autostarttoken=${view.autoStartToken}&redirect=null`}
              className="mb-2 block w-full rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              Öppna BankID på den här enheten
            </a>
            {view.hintCode === "userSign" && (
              <p className="mt-3 text-sm text-slate-500">Skriv din säkerhetskod i BankID-appen…</p>
            )}
          </>
        )}

        {view.kind === "failed" && (
          <>
            <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{view.message}</p>
            <button
              type="button"
              onClick={() => void start()}
              className="w-full rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              Försök igen
            </button>
          </>
        )}

        <p className="mt-6 text-sm text-slate-500">
          <button type="button" onClick={() => navigate("/login")} className="underline">
            Logga in med lösenord i stället
          </button>
        </p>
      </div>
    </div>
  );
}
