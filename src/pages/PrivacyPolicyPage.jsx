import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/Logo";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-700">
      <header className="border-b border-emerald-900/10 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <Logo showTagline />
          <Link to="/" className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-900 hover:text-emerald-700">
            <ArrowLeft className="h-4 w-4" /> Home
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-12">
        <article className="rounded-2xl border border-emerald-900/10 bg-white p-6 shadow-sm md:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-800">METHO AAY-UPAY</p>
          <h1 className="mt-3 font-display text-3xl font-black tracking-tight text-emerald-950 md:text-4xl">Privacy Policy</h1>
          <p className="mt-3 text-sm text-slate-500">Last updated: August 13, 2026</p>

          <div className="mt-8 space-y-7 text-sm leading-7">
            <section>
              <h2 className="font-display text-xl font-bold text-emerald-950">1. About This Policy</h2>
              <p className="mt-2">Metho Logistics Private Limited operates METHO AAY-UPAY, including its website, mobile application, member services, partner tools, product storefronts, and related business services. This policy explains how we collect, use, and protect information when you use our services.</p>
            </section>
            <section>
              <h2 className="font-display text-xl font-bold text-emerald-950">2. Information We Collect</h2>
              <p className="mt-2">Depending on the service you use, we may collect your name, phone number, email address, address, member or partner identifiers, login credentials, order details, payment references, uploaded documents or images, and information you provide to customer support.</p>
              <p className="mt-2">We may also collect basic device, browser, log, and usage information needed for security, reliability, analytics, and service operation.</p>
            </section>
            <section>
              <h2 className="font-display text-xl font-bold text-emerald-950">3. How We Use Information</h2>
              <p className="mt-2">We use information to create and manage accounts, verify members and partners, process orders and payments, provide wallet and commission services, display partner storefronts, support image and document uploads, prevent fraud and abuse, communicate important service updates, and improve the platform.</p>
            </section>
            <section>
              <h2 className="font-display text-xl font-bold text-emerald-950">4. Payments and Sharing</h2>
              <p className="mt-2">Payment information is processed through the payment method selected during checkout. We do not request or store UPI PIN, ATM PIN, CVV, or one-time passwords. We share information only with service providers and partners when needed to deliver the requested service, process a transaction, meet legal obligations, or protect the platform and its users.</p>
            </section>
            <section>
              <h2 className="font-display text-xl font-bold text-emerald-950">5. Images and Uploaded Content</h2>
              <p className="mt-2">Images, logos, product media, payment proofs, and other files uploaded through authorised account areas may be stored and displayed for the purpose selected by the uploader. Users should not upload content they do not have permission to use or content containing unnecessary sensitive information.</p>
            </section>
            <section>
              <h2 className="font-display text-xl font-bold text-emerald-950">6. Security and Retention</h2>
              <p className="mt-2">We use access controls, authentication, validation, and operational safeguards appropriate to the service. We retain information only for as long as reasonably required for account operation, transactions, legal obligations, dispute handling, security, and legitimate business purposes.</p>
            </section>
            <section>
              <h2 className="font-display text-xl font-bold text-emerald-950">7. Your Choices</h2>
              <p className="mt-2">You may review or update account information through the available account settings. To request access, correction, account deletion, or deletion of personal data, email us from the email address linked to your account. Some transaction, tax, fraud-prevention, or legal records may need to be retained where required by law.</p>
            </section>
            <section>
              <h2 className="font-display text-xl font-bold text-emerald-950">8. Contact</h2>
              <p className="mt-2">For privacy questions, account deletion, or personal data requests, contact Metho Logistics Private Limited at <a className="font-semibold text-emerald-800 underline" href="mailto:admin@metho.com">admin@metho.com</a>. Please include your registered mobile number or Member ID so we can identify the correct account.</p>
            </section>
          </div>
        </article>
      </main>
    </div>
  );
}
