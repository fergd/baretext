Row background states. Selected = tonal accent-container pill; hovered = neutral state layer; else transparent.

```jsx
<SelectionPill selected={isActive} hovered={isHover} style={{padding:'8px 12px'}}>...</SelectionPill>
```

SceneRow uses this internally — reach for it when composing custom rows.
