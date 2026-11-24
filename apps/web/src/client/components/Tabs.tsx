/** A row of tabs; the page shows the panel of the selected one. */
export function Tabs<K extends string>({ tabs, value, onChange, label }: { tabs: [K, string, number?][]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="tabs">
      {tabs.map(([key, text, count]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => {
            onChange(key);
          }}
        >
          {text}
          {count !== undefined && <span className="tab-count">{count}</span>}
        </button>
      ))}
    </div>
  );
}
