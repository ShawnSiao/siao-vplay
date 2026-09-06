import { readableRelationships } from "./readableRelationships";

export function SummaryRelationships({ source }: { source: string }) {
  const relationships = readableRelationships(source);
  return <section className="summary-mermaid"><h3>关系说明</h3>
    {relationships ? <ul>{relationships.map((item, index) => <li key={index}>{`${item.from} → ${item.to}${item.label ? `：${item.label}` : ""}`}</li>)}</ul>
      : <p>此关系图的格式暂不支持显示，请参阅正文中的结构与关系说明。</p>}
  </section>;
}
