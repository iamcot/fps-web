// Lớp phủ scope: đen ngoài vòng tròn + chữ thập mảnh. Chỉ là DOM, không đụng logic.
const RADIUS_FRAC = 0.46   // bán kính vòng tròn theo nửa cạnh ngắn của màn hình... tính trên min(w,h)

export function createScope() {
  const root = document.createElement('div')
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:11;display:none;' +
    `background:radial-gradient(circle at 50% 50%, transparent calc(min(100vw,100vh) * ${RADIUS_FRAC} - 1px), #000 calc(min(100vw,100vh) * ${RADIUS_FRAC}))`
  const line = (css: string) => {
    const l = document.createElement('div')
    l.style.cssText = 'position:absolute;background:#000;' + css
    root.appendChild(l)
  }
  // Chữ thập chạy hết đường kính vòng tròn
  line(`left:calc(50% - min(100vw,100vh) * ${RADIUS_FRAC});width:calc(min(100vw,100vh) * ${RADIUS_FRAC * 2});top:calc(50% - 1px);height:2px`)
  line(`top:calc(50% - min(100vw,100vh) * ${RADIUS_FRAC});height:calc(min(100vw,100vh) * ${RADIUS_FRAC * 2});left:calc(50% - 1px);width:2px`)
  document.body.appendChild(root)
  let shown = false
  return {
    setVisible(v: boolean) {
      if (v === shown) return
      shown = v
      root.style.display = v ? 'block' : 'none'
    },
  }
}
