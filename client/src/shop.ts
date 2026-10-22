// Giỏ hàng + menu cửa hàng (H.7). Chỉ hiển thị và gửi lệnh Buy; tiền/loadout/vùng mua do server quyết định.
import { CATEGORY_LABEL, CATEGORY_SLOT, ECONOMY, GRENADE, type EconomyConfig, WEAPONS, quoteBuy, type Loadout, type OwnedWeapon, type WeaponCategory } from '@fps/shared'
import { WEAPON_LABEL, weaponIcon } from './weaponIcon'
import { t, categoryLabel } from './i18n'

export interface ShopDeps {
  money(): number
  loadout(): (OwnedWeapon | null)[]
  eco?(): EconomyConfig            // luật kinh tế của thể thức (mặc định Hỗn Chiến)
  canShop(): boolean              // đang trong khu mua, còn sống, trận chưa ENDED, đang online
  send(key: string): void         // gửi lệnh Buy
  onOpenChange?(open: boolean): void
  sounds: { ok(): void; fail(): void }
}

// Menu 2 cấp: phím số cấp 1 (2–5) chọn dòng súng, cấp 2 chọn loại. Mua AK47 = B 4 2.
interface GroupDef { num: number; cat: WeaponCategory; items: [number, string][] }
const GROUPS: GroupDef[] = [
  { num: 2, cat: 'pistol', items: [[1, 'colt'], [2, 'rulo']] },
  { num: 3, cat: 'mid', items: [[1, 'shotgun'], [2, 'smg']] },
  { num: 4, cat: 'long', items: [[1, 'm16'], [2, 'ak47'], [6, 'sniper']] },
  { num: 5, cat: 'grenade', items: [[1, GRENADE.key]] },
]

const STYLE = `
.shop-cart{position:fixed;left:24px;top:50%;transform:translateY(-50%);z-index:26;display:flex;align-items:center;gap:6px;color:#fff;
  font:14px sans-serif;text-shadow:0 0 4px #000;opacity:.3;pointer-events:auto;cursor:pointer;user-select:none;border-radius:10px;padding:6px 8px;transition:opacity 150ms,left 200ms ease}
.shop-cart svg{width:36px;height:36px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.shop-cart.shift{left:224px}
.shop-cart.shift2{left:564px}
.shop-cart.on{opacity:1;animation:shop-glow 2.4s ease-in-out infinite}
@keyframes shop-glow{0%,100%{box-shadow:0 0 0 rgba(255,255,255,0)}50%{box-shadow:0 0 14px rgba(255,255,255,.55)}}
.shop-panel{position:fixed;left:0;top:15%;width:200px;max-height:70vh;overflow:auto;z-index:25;box-sizing:border-box;padding:14px 14px 10px;
  background:rgba(10,12,16,.88);border-radius:0 12px 12px 0;color:#fff;font:14px sans-serif;transform:translateX(-100%);transition:transform 200ms ease;pointer-events:none}
.shop-panel.open{transform:translateX(0);pointer-events:auto}
.shop-sub{left:200px;width:340px;border-radius:0 12px 12px 0;border-left:1px solid rgba(255,255,255,.2);z-index:24;transform:translateX(calc(-100% - 200px))}
.shop-sub.open{transform:translateX(0)}
.shop-grp{display:flex;align-items:center;gap:8px;padding:7px 6px;border-radius:6px;cursor:pointer;font-weight:700}
.shop-grp:hover,.shop-grp.sel{background:rgba(255,255,255,.14)}
.shop-grp .badge{flex:none;min-width:24px;text-align:center;font:bold 12px monospace;border:1px solid rgba(255,255,255,.5);border-radius:5px;padding:1px 0}
.shop-grp .cur{display:block;font-size:10.5px;font-weight:400;color:#9aa0aa}
.shop-head{display:flex;justify-content:space-between;align-items:baseline;font-weight:800;font-size:16px;margin-bottom:6px}
.shop-head .m{color:#5fd16b}
.shop-line{border-top:1px solid rgba(255,255,255,.25);margin-top:8px}
.shop-cat{font-size:11px;color:#9aa0aa;text-transform:uppercase;letter-spacing:.06em;margin:3px 0 2px}
.shop-row{display:flex;align-items:center;gap:8px;padding:3px 4px;border-radius:6px;cursor:pointer;position:relative}
.shop-row:hover{background:rgba(255,255,255,.08)}
.shop-row .badge{flex:none;min-width:24px;text-align:center;font:bold 12px monospace;border:1px solid rgba(255,255,255,.5);border-radius:5px;padding:1px 0}
.shop-row .ico{flex:none;width:96px;height:40px;display:flex;align-items:center;justify-content:center}
.shop-row .ico img{width:96px;height:40px}
.shop-row .nm{flex:1;font-weight:700}
.shop-row .pr{font-weight:800}
.shop-row .sub{position:absolute;left:136px;bottom:-2px;font-size:10.5px;color:#9aa0aa;white-space:nowrap}
.shop-row.has-sub{padding-bottom:13px}
.shop-row.dim{opacity:.5}
.shop-row.dim.owned{opacity:.6}
.shop-row .pr.bad{color:#ff5555}
.shop-row.ok-flash{animation:shop-ok 500ms ease-out}
@keyframes shop-ok{0%{background:rgba(95,209,107,.65)}100%{background:rgba(95,209,107,0)}}
.shop-row.shake{animation:shop-shake 150ms linear}
@keyframes shop-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
.shop-foot{font-size:12px;color:#9aa0aa;margin-top:10px;line-height:1.4}
`

const CART = '<svg viewBox="0 0 24 24"><path d="M2 3h3l2.2 11.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.5L21 7H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>'

export function createShop(deps: ShopDeps) {
  const st = document.createElement('style')
  st.textContent = STYLE
  document.head.appendChild(st)

  const cart = document.createElement('div')
  cart.className = 'shop-cart'
  cart.innerHTML = CART + '<span>(B)</span><span class="bt" style="color:#ffd23c"></span>'
  const buyEl = cart.querySelector('.bt') as HTMLElement
  document.body.appendChild(cart)

  const panel = document.createElement('div')
  panel.className = 'shop-panel'
  document.body.appendChild(panel)
  const head = document.createElement('div')
  head.className = 'shop-head'
  head.innerHTML = `<span>${t('SHOP')}</span><span class="m"></span>`
  const moneyEl = head.querySelector('.m') as HTMLElement
  panel.appendChild(head)

  const sub = document.createElement('div')
  sub.className = 'shop-panel shop-sub'
  document.body.appendChild(sub)

  interface Row { key: string; el: HTMLElement; pr: HTMLElement; sub: HTMLElement }
  interface Grp { def: GroupDef; el: HTMLElement; cur: HTMLElement; box: HTMLElement; rows: Map<number, Row> }
  const rows: Row[] = []
  const groups: Grp[] = []
  for (const g of GROUPS) {
    const gel = document.createElement('div'); gel.className = 'shop-grp'
    const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = `(${g.num})`
    const txt = document.createElement('span')
    txt.textContent = categoryLabel(g.cat)
    const cur = document.createElement('span'); cur.className = 'cur'
    txt.appendChild(cur)
    gel.append(badge, txt)
    panel.appendChild(gel)
    const box = document.createElement('div'); box.style.display = 'none'
    sub.appendChild(box)
    const grp: Grp = { def: g, el: gel, cur, box, rows: new Map() }
    gel.addEventListener('click', () => openGroup(grp))
    for (const [num, key] of g.items) {
      const w = WEAPONS.find(x => x.key === key)
      if (!w || !w.buyable) continue
      const el = document.createElement('div')
      el.className = 'shop-row'
      const bd = document.createElement('span'); bd.className = 'badge'; bd.textContent = `(${num})`
      const ico = document.createElement('span'); ico.className = 'ico'; ico.appendChild(weaponIcon(w.key, WEAPON_LABEL[w.key] ?? w.name))
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = WEAPON_LABEL[w.key] ?? w.name
      const pr = document.createElement('span'); pr.className = 'pr'
      const sb = document.createElement('span'); sb.className = 'sub'
      el.append(bd, ico, nm, pr, sb)
      el.addEventListener('click', () => buyKey(key))
      box.appendChild(el)
      const row: Row = { key: w.key, el, pr, sub: sb }
      rows.push(row); grp.rows.set(num, row)
    }
    groups.push(grp)
  }
  const foot = document.createElement('div')
  foot.className = 'shop-line'
  const footTxt = document.createElement('div')
  footTxt.className = 'shop-foot'
  footTxt.textContent = t('You can carry one gun per slot. Buying into a taken slot sells your current gun ({pct}%).\nMax {n} grenades, not refundable.', { pct: Math.round((deps.eco?.() ?? ECONOMY).sellRatio * 100), n: GRENADE.maxCarry })
  footTxt.style.whiteSpace = 'pre-line'
  panel.append(foot, footTxt)

  let selected: Grp | null = null
  let open = false
  let drawKey = ''
  const asLoadout = (): Loadout => ({ slots: deps.loadout() })

  function setOpen(v: boolean): void {
    if (v === open) return
    open = v
    if (!v) selectGroup(null)
    panel.classList.toggle('open', v)
    cart.classList.toggle('shift', v)   // menu trượt ra từ mép trái: đẩy giỏ sang phải để không bị đè
    deps.onOpenChange?.(v)
  }

  function selectGroup(g: Grp | null): void {
    selected = g
    for (const x of groups) { x.el.classList.toggle('sel', x === g); x.box.style.display = x === g ? '' : 'none' }
    sub.classList.toggle('open', g !== null)
    cart.classList.toggle('shift2', g !== null)
  }
  function openGroup(g: Grp): void { if (open) { drawKey = ''; selectGroup(g) } }

  function refresh(): void {
    const money = deps.money()
    const lo = asLoadout()
    const key = `${money}|${lo.slots.map(w => (w ? w.key + w.paid + ':' + (w.count ?? 0) : '-')).join(',')}`
    if (key === drawKey) return
    drawKey = key
    moneyEl.textContent = `$${money}`
    for (const g of groups) {
      const w = lo.slots[CATEGORY_SLOT[g.def.cat]]
      g.cur.textContent = w ? (WEAPON_LABEL[w.key] ?? w.key) + (w.count ? ` ×${w.count}` : '') : '—'
    }
    for (const r of rows) {
      const q = quoteBuy(money, lo, r.key, deps.eco?.())
      const def = WEAPONS.find(w => w.key === r.key)!
      const old = lo.slots[CATEGORY_SLOT[def.category]] ?? null
      const owned = !q.ok && q.reason === 'already_owned'
      const full = !q.ok && q.reason === 'max_carry'
      const cnt = def.consumable ? (old?.count ?? 0) : 0
      r.pr.textContent = owned ? t('In use') : full ? t('Full ({c}/{m})', { c: cnt, m: GRENADE.maxCarry }) : def.consumable && cnt > 0 ? `${cnt}/${GRENADE.maxCarry} · $${def.price}` : `$${def.price}`
      r.pr.classList.toggle('bad', !q.ok && q.reason === 'not_enough_money')
      r.el.classList.toggle('dim', !q.ok)
      r.el.classList.toggle('owned', owned)
      let sub = ''
      if (old && !owned && !def.consumable) {
        const oldName = WEAPON_LABEL[old.key] ?? old.key
        const refund = q.refund
        sub = refund > 0
          ? t('sell {old} +${refund} · {verb} ${amt}', { old: oldName, refund, verb: t(q.net >= 0 ? 'pay' : 'get'), amt: Math.abs(q.net) })
          : t('{old} is a starter weapon, no refund', { old: oldName })
      }
      r.sub.textContent = sub
      r.el.classList.toggle('has-sub', sub !== '')
    }
  }

  function buyKey(key: string): void {
    if (!deps.canShop()) return
    const q = quoteBuy(deps.money(), asLoadout(), key, deps.eco?.())
    if (!q.ok) { feedback(key, false); return }
    deps.send(key)
  }

  function feedback(key: string, ok: boolean): void {
    const r = rows.find(x => x.key === key)
    if (r) {
      const cls = ok ? 'ok-flash' : 'shake'
      r.el.classList.remove('ok-flash', 'shake')
      void r.el.offsetWidth
      r.el.classList.add(cls)
      setTimeout(() => r.el.classList.remove(cls), 520)
    }
    if (ok) deps.sounds.ok(); else deps.sounds.fail()
  }

  cart.addEventListener('click', () => api.toggle())

  const api = {
    get isOpen(): boolean { return open },
    toggle(): void { if (open) setOpen(false); else if (deps.canShop()) setOpen(true) },
    close(): void { setOpen(false) },
    /** Phím số khi menu mở: cấp 1 chọn dòng súng (2–5), cấp 2 chọn loại. true nếu đã xử lý (không đổi súng) */
    digit(n: number): boolean {
      if (!open) return false
      if (!selected) {
        const g = groups.find(x => x.def.num === n)
        if (g) openGroup(g)
        return true
      }
      const r = selected.rows.get(n)
      if (r) buyKey(r.key)
      else { const g = groups.find(x => x.def.num === n); if (g) openGroup(g) }   // bấm số dòng khác khi đang ở cấp 2: nhảy sang dòng đó
      return true
    },
    onBuyResult(ok: boolean, key: string): void { feedback(key, ok); if (ok) setOpen(false) },   // mua xong tự đóng cửa hàng
    /** Gọi mỗi frame: tự đóng khi ra khỏi khu mua / chết / hết trận, cập nhật giỏ + danh sách */
    tick(): void {
      const can = deps.canShop()
      cart.classList.toggle('on', can)
      const hide = !!deps.eco?.().noShop   // Cận Chiến: không có cửa hàng
      if ((cart.style.display === 'none') !== hide) cart.style.display = hide ? 'none' : ''
      if (!can && open) setOpen(false)
      if (open) refresh()
    },
    /** Thời gian mua còn lại (ms) cạnh giỏ hàng; null = ẩn */
    setBuyLeft(ms: number | null): void {
      const t = ms === null ? '' : ` Mua: ${Math.floor(Math.ceil(ms / 1000) / 60)}:${String(Math.ceil(ms / 1000) % 60).padStart(2, '0')}`
      if (buyEl.textContent !== t) buyEl.textContent = t
    },
    /** Dùng khi mở bằng click lúc đổi trạng thái tiền: buộc vẽ lại */
    invalidate(): void { drawKey = '' },
  }
  return api
}
export type Shop = ReturnType<typeof createShop>
