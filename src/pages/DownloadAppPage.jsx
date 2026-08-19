import React from "react";
import { Download, ShieldCheck, Smartphone } from "lucide-react";
import { Link } from "react-router-dom";
import { Logo } from "@/components/Logo";

const APK_URL = "/downloads/metho-aay-upay-1.0.0.apk";
const APK_SIZE = "1,249,199 bytes";
const APK_SHA256 = "7E45A4B5C10E25C5C00ACE94CA308AD1EA4CFACFF78171B893D9868D7F84CEE5";

export default function DownloadAppPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(6,78,59,0.16),transparent_38%),linear-gradient(180deg,#f8fffd_0%,#effcf6_52%,#ecfdf5_100%)] px-4 py-8 text-slate-900" data-testid="download-page">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between">
          <Logo />
          <Link to="/" className="rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-900 shadow-sm hover:bg-emerald-50">Home</Link>
        </div>

        <section className="mt-8 overflow-hidden rounded-3xl border border-emerald-200 bg-white/95 shadow-xl">
          <div className="bg-emerald-950 px-6 py-8 text-white md:px-8">
            <div className="flex items-center gap-3 text-emerald-200">
              <Smartphone className="h-6 w-6" />
              <span className="text-sm font-semibold uppercase tracking-[0.18em]">Official Android App</span>
            </div>
            <h1 className="mt-4 text-3xl font-black leading-tight md:text-4xl">METHO AAY-UPAY</h1>
            <p className="mt-2 max-w-lg text-emerald-100">Download the verified Android release for a fast, secure mobile experience.</p>
          </div>

          <div className="space-y-6 px-6 py-7 md:px-8">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Version</p><p className="mt-1 font-bold text-emerald-950">1.0.0</p></div>
              <div className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Version code</p><p className="mt-1 font-bold text-emerald-950">1</p></div>
              <div className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">APK size</p><p className="mt-1 font-bold text-emerald-950">{APK_SIZE}</p></div>
            </div>

            <a href={APK_URL} download className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-emerald-900 px-6 font-bold text-white shadow-lg transition-colors hover:bg-emerald-950" data-testid="download-apk-button">
              <Download className="h-5 w-5" /> Download APK
            </a>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><ShieldCheck className="h-5 w-5 text-emerald-700" /> Verified release checksum</div>
              <p className="mt-3 break-all font-mono text-xs leading-5 text-slate-600">{APK_SHA256}</p>
            </div>

            <div>
              <h2 className="text-lg font-bold text-emerald-950">Install on Android</h2>
              <ol className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                <li>1. Download the APK.</li>
                <li>2. Open the downloaded APK.</li>
                <li>3. If Android asks, allow installation from this source.</li>
                <li>4. Install METHO AAY-UPAY.</li>
              </ol>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
