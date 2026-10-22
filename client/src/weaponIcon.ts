import { t } from './i18n'
// Icon vũ khí: ưu tiên PNG (render từ model bằng tools/blender/render_icon.py), không có thì SVG tạm, không có nữa thì chữ.
const BASE = '/icons/weapons/'

export function weaponIcon(key: string, name: string, css = ''): HTMLElement {
  const img = document.createElement('img')
  img.alt = name
  img.draggable = false
  img.style.cssText = 'object-fit:contain;pointer-events:none;' + css
  let stage = 0
  img.addEventListener('error', () => {
    stage++
    if (stage === 1) img.src = `${BASE}${key}.svg`
    else {
      const t = document.createElement('span')
      t.textContent = name
      t.style.cssText = 'font:bold 11px sans-serif;color:#fff;text-align:center;' + css
      img.replaceWith(t)
    }
  })
  img.src = `${BASE}${key}.png`
  return img
}

/** Tên hiển thị trong cửa hàng */
export const WEAPON_LABEL: Record<string, string> = {
  knife: t('Knife'), colt: 'Colt', rulo: t('Revolver'), shotgun: 'Shotgun', smg: 'SMG', ak47: 'AK47', m16: 'M16', sniper: 'Sniper',
}
