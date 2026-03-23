//FILE: src/utils/share-formats.js
export function buildShareText(fmt, finalText, pkg){
  const o = pkg.outputs;
  const headline = o.topHeadline || o.headlines?.[0] || "News Update";

  if(fmt === "social"){
    const spots = o.spots?.slice(0,2)?.filter(Boolean) || [];
    const line = spots.length ? `\n\n• ${spots.join("\n• ")}` : "";
    return `${headline}\n${line}\n\n#News`;
  }

  if(fmt === "email"){
    const author = buildAuthor(pkg);
    const briefSpots = o.spots?.slice(0,2)?.filter(Boolean) || [];
    return `${headline}\n\n${author}${author? "\n\n":""}${briefSpots.map(s=>"• "+s).join("\n")}\n\n---\n${finalText}`;
  }

  if(fmt === "broadcast"){
    const rundown = [];
    rundown.push(`RUNDOWN: ${headline}`);
    if(o.spots?.length) rundown.push(...o.spots.filter(Boolean).map((s,i)=>`${i+1}) ${s}`));
    rundown.push("");
    rundown.push("KEY QUOTES:");
    rundown.push(...(o.quotes||[]).filter(Boolean).slice(0,3).map(q=>`- ${q}`));
    return rundown.join("\n");
  }

  // full
  return finalText;
}

function buildAuthor(pkg){
  const name = (pkg.inputs.authorName||"").trim();
  const loc = (pkg.inputs.authorLocation||"").trim();
  const parts = [];
  if(name) parts.push(name.toUpperCase());
  if(loc) parts.push(loc.toUpperCase());
  return parts.join("\n");
}
