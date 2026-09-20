"use client";
import { useEffect, useState } from "react";
export default function CollectionThumbnail({file}: {file: File}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const value = URL.createObjectURL(file);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [file]);
  return url ? <img src={url} alt={file.name} loading="lazy" decoding="async" /> : <div className="collection-item-fallback">{file.name.split(".").pop()?.toUpperCase()}</div>;
}
