"use client";

// ── LEGAL NOTICE FOR DEVELOPERS ──────────────────────────────────────────────
// The text in TERMS_SECTIONS below is a first-pass draft based on public
// research into comparable platforms' terms of service. It has NOT been
// reviewed by a lawyer and should not gate real users until it has been.
// Replace TERMS_VERSION and the section content once counsel signs off.
// ──────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";

const TERMS_VERSION = "draft-0.2";
const STORAGE_KEY = "mintforge-tos-accepted";

const TERMS_SECTIONS = [
  {
    heading: "1. What MintForge Is",
    body: "MintForge is a technical and administrative platform that helps creators configure, and helps holders view and manage, non-fungible tokens (\"NFTs\") across supported blockchain networks. MintForge is not a broker, financial institution, custodian, or creditor. MintForge is not a party to any mint, sale, offer, staking arrangement, or other transaction between users. All transactions occur directly on-chain between the wallets involved.",
  },
  {
    heading: "2. Eligibility & Sanctions Representation",
    body: "By using MintForge, you represent and warrant that you are not located in, or a resident of, any country subject to a comprehensive U.S. Government embargo; that you are not listed on any sanctions or restricted-party list maintained by the U.S. Treasury's Office of Foreign Assets Control, the European Union, the United Nations Security Council, or the government of your home jurisdiction; and that you are not acting on behalf of any person or entity so listed. You are solely responsible for ensuring your use of MintForge complies with the laws applicable to you.",
  },
  {
    heading: "3. No Investment Advice; Assumption of Risk",
    body: "Nothing on MintForge constitutes investment, financial, tax, or legal advice. NFTs and any associated reward tokens are not insured or guaranteed by any government agency or deposit protection scheme. Their value is volatile and may fall to zero. Staking reward rates, where offered, are set by individual creators and are not guaranteed returns. You acknowledge you may lose the full value of anything you mint, hold, stake, or trade through MintForge, and that blockchain network fees are final and non-refundable regardless of transaction outcome.",
  },
  {
    heading: "4. Intellectual Property",
    body: "MintForge claims no ownership over content that creators upload or mint. Creators represent that they own, or have obtained all necessary rights and permissions for, any content they upload. Acquiring an NFT does not by itself grant the acquirer any reproduction, adaptation, public display, or commercial rights in the underlying content beyond what the creator has explicitly and separately licensed. MintForge may remove content that infringes third-party intellectual property rights or violates this policy, with or without prior notice.",
  },
  {
    heading: "5. Prohibited Content & Conduct",
    body: "You may not upload, mint, or list content that is unlawful, that depicts or facilitates the exploitation of minors, that infringes another party's intellectual property rights, that is fraudulent or deceptive, or that violates applicable sanctions, export control, or anti-money-laundering law. MintForge reserves the right to remove any content and suspend or terminate access for any user at its sole discretion.",
  },
  {
    heading: "6. Wallet and Smart-Contract Custody",
    body: "You retain control of your wallet and private keys. Staking transfers NFTs to the staking contract until you withdraw them; marketplace offers escrow the offered funds in the marketplace contract. Sale proceeds and rewards remain in their respective contracts until withdrawn. MintForge cannot reverse confirmed blockchain transactions or recover lost keys. Review each contract and wallet request before approving it.",
  },
  {
    heading: "7. Marketplace & Royalty Disclaimer",
    body: "Where MintForge signals a creator royalty on-chain (for example, via ERC-2981), such royalties are a signal only. Whether a given marketplace or counterparty actually honors and pays that royalty on a resale depends on that marketplace's own policies and is outside MintForge's control.",
  },
  {
    heading: "8. Disclaimers & Limitation of Liability",
    body: "MintForge is provided on an \"as is\" and \"as available\" basis without warranties of any kind, whether express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, non-infringement, accuracy, or uninterrupted or error-free operation. To the maximum extent permitted by applicable law, MintForge and its operators will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of profits, data, or digital assets, arising from your use of the platform.",
  },
  {
    heading: "9. Governing Law & Changes",
    body: "These terms are governed by the laws applicable to MintForge's operating entity, without regard to conflict-of-law principles. MintForge may update these terms from time to time; continued use of the platform after an update constitutes acceptance of the revised terms. Where required by applicable consumer protection law, certain provisions of these terms may not apply to you, or additional rights may be available to you.",
  },
];

export default function LegalGate({ onAccept }: { onAccept: () => void }) {
  const [phase, setPhase] = useState<"checking" | "loading" | "terms" | "declined">("checking");
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let accepted = "";
    try {
      accepted = localStorage.getItem(STORAGE_KEY) || "";
    } catch {
      accepted = "";
    }
    if (accepted === TERMS_VERSION) {
      onAccept();
      return;
    }
    setPhase("loading");
    const timer = window.setTimeout(() => setPhase("terms"), 1400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScroll() {
    const node = scrollRef.current;
    if (!node) return;
    if (node.scrollHeight - node.scrollTop - node.clientHeight < 24) setScrolledToEnd(true);
  }

  function accept() {
    try {
      localStorage.setItem(STORAGE_KEY, TERMS_VERSION);
    } catch {
      // localStorage unavailable — acceptance still proceeds for this session
    }
    onAccept();
  }

  if (phase === "checking") return null;

  if (phase === "loading") {
    return (
      <div className="legal-gate-loading">
        <div className="legal-gate-mark"><span /><span /><span /></div>
        <b>MINTFORGE</b>
        <p>Preparing your session…</p>
      </div>
    );
  }

  if (phase === "declined") {
    return (
      <div className="legal-gate-loading">
        <div className="legal-gate-mark declined"><span>!</span></div>
        <b>Access requires acceptance</b>
        <p>You must accept the Terms of Service to use MintForge.</p>
        <button type="button" className="legal-gate-revisit" onClick={() => setPhase("terms")}>Review terms again</button>
      </div>
    );
  }

  return (
    <div className="legal-gate-overlay" role="dialog" aria-modal="true" aria-label="Terms of Service">
      <div className="legal-gate-card">
        <div className="legal-gate-head">
          <span>BEFORE YOU CONTINUE</span>
          <h1>Terms of Service</h1>
          <p>Please read the terms below. Scroll to the end to enable acceptance.</p>
        </div>
        <div className="legal-gate-scroll" ref={scrollRef} onScroll={handleScroll}>
          {TERMS_SECTIONS.map((section) => (
            <section key={section.heading}>
              <h3>{section.heading}</h3>
              <p>{section.body}</p>
            </section>
          ))}
          <div className="legal-gate-end">— End of terms —</div>
        </div>
        <div className="legal-gate-actions">
          <button type="button" className="legal-gate-decline" onClick={() => setPhase("declined")}>Decline</button>
          <button type="button" className="legal-gate-accept" onClick={accept} disabled={!scrolledToEnd}>{scrolledToEnd ? "Accept and continue" : "Scroll to enable"}</button>
        </div>
      </div>
    </div>
  );
}