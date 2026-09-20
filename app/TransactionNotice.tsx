"use client";
import { getChain } from "../lib/chains";
export default function TransactionNotice({
  message,
  hash,
  chainId,
}: {
  message: string;
  hash?: string;
  chainId: string;
}) {
  if (!message && !hash) return null;
  return (
    <div className="mf-notice" role="status" aria-live="polite">
      <p>{message}</p>
      {hash && (
        <a
          href={getChain(chainId).explorer + "/tx/" + hash}
          target="_blank"
          rel="noreferrer"
        >
          View transaction ↗
        </a>
      )}
    </div>
  );
}
