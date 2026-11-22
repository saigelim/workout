// 내 운동 추가 / 수정
import { catalog, saveCustomExercise, deleteCustomExercise, SLOT_LABEL, SLOT_BODYPART, EQUIPMENT, AVOID_PARTS, LOAD_TYPES } from '../catalog.js';
import { esc, toast } from '../ui.js';

const DEFAULT_INCREMENT = { 머신: 2.5, 바벨: 2.5, 케이블: 1.25, 덤벨: 1, 케틀벨: 4, 밴드: 0, 맨몸: 0, 기타: 1 };

function opt(value, label, selected) {
  return `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;
}

export async function render(el, params = []) {
  const editId = params[0] === 'edit' ? decodeURIComponent(params[1] || '') : null;
  const { byId, exercises } = catalog();
  const ex = editId ? byId[editId] : null;
  if (editId && (!ex || !ex.custom)) {
    el.innerHTML = '<h1>찾을 수 없어요</h1><p class="muted">기본 동작은 수정할 수 없고, 사용 여부만 바꿀 수 있어요.</p><a class="btn" href="#/exercises">운동 DB로</a>';
    return;
  }
  const v = ex || { name: '', slot: 'squat', equipment: '머신', level: 1, loadType: 'weight', increment: 2.5, tabataOk: false, lowImpact: true, avoidFor: [], tips: [] };

  el.innerHTML = `
    <a href="#/exercises" class="back">← 운동 DB</a>
    <h1>${ex ? '내 운동 수정' : '내 운동 추가'}</h1>
    <form class="form card" novalidate>
      <label class="field">동작 이름
        <input name="name" required maxlength="40" value="${esc(v.name)}" placeholder="예: 스텝박스 업">
      </label>
      <p class="warn" id="name-msg" hidden></p>

      <label class="field">분류 (교체할 때 같은 분류끼리 추천돼요)
        <select name="slot">${Object.entries(SLOT_LABEL).map(([k, l]) => opt(k, l, v.slot === k)).join('')}</select>
      </label>

      <div class="row">
        <label class="field">기구
          <select name="equipment">${EQUIPMENT.map((q) => opt(q, q, v.equipment === q)).join('')}</select>
        </label>
        <label class="field">난이도
          <select name="level">${[1, 2, 3].map((n) => opt(n, ['', '초급', '중급', '상급'][n], v.level === n)).join('')}</select>
        </label>
      </div>

      <div class="row">
        <label class="field">기록 방식
          <select name="loadType">${Object.entries(LOAD_TYPES).map(([k, l]) => opt(k, l, v.loadType === k)).join('')}</select>
        </label>
        <label class="field" id="inc-field">무게 올리는 단위(kg)
          <input name="increment" type="number" inputmode="decimal" min="0" step="0.25" value="${esc(v.increment)}">
        </label>
      </div>

      <fieldset class="field">
        <legend>특징</legend>
        <label class="check"><input type="checkbox" name="tabataOk" ${v.tabataOk ? 'checked' : ''}> 타바타 동작으로 쓸 수 있어요</label>
        <label class="check"><input type="checkbox" name="lowImpact" ${v.lowImpact ? 'checked' : ''}> 저강도예요 (뛰지 않음, 컨디션 나쁠 때 대체용)</label>
      </fieldset>

      <fieldset class="field">
        <legend>이 부위가 불편하면 추천하지 않기</legend>
        <div class="chips">
          ${AVOID_PARTS.map((p) => `<label class="check chip-check"><input type="checkbox" name="avoid" value="${esc(p)}" ${v.avoidFor.includes(p) ? 'checked' : ''}> ${esc(p)}</label>`).join('')}
        </div>
      </fieldset>

      <label class="field">자세 팁 (한 줄에 하나씩)
        <textarea name="tips" rows="3" placeholder="예: 무릎이 발끝보다 너무 나가지 않게">${esc((v.tips || []).join('\n'))}</textarea>
      </label>

      <button class="btn primary" type="submit">저장</button>
      ${ex ? '<button class="btn danger" type="button" id="delete">삭제</button>' : ''}
    </form>
  `;

  const form = el.querySelector('form');
  const incField = el.querySelector('#inc-field');
  const syncInc = () => {
    const lt = form.loadType.value;
    incField.hidden = !(lt === 'weight' || lt === 'assisted');
  };
  form.loadType.addEventListener('change', syncInc);
  form.equipment.addEventListener('change', () => {
    if (!ex) form.increment.value = DEFAULT_INCREMENT[form.equipment.value] ?? 1;
  });
  syncInc();
  form.name.addEventListener('input', () => { el.querySelector('#name-msg').hidden = true; });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = form.name.value.trim();
    const msg = el.querySelector('#name-msg');
    if (!name) {
      msg.textContent = '동작 이름을 적어주세요.'; msg.hidden = false; form.name.focus(); return;
    }
    const dup = exercises.find((e) => e.name === name && e.id !== editId);
    if (dup) {
      msg.textContent = `'${name}'은(는) 이미 있어요. 다른 이름을 써주세요.`; msg.hidden = false; form.name.focus(); return;
    }
    const loadType = form.loadType.value;
    const data = {
      id: ex ? ex.id : `c_${Date.now().toString(36)}`,
      name,
      slot: form.slot.value,
      bodyPart: SLOT_BODYPART[form.slot.value],
      equipment: form.equipment.value,
      level: Number(form.level.value),
      loadType,
      increment: (loadType === 'weight' || loadType === 'assisted') ? Math.max(0, Number(form.increment.value) || 0) : 0,
      tabataOk: form.tabataOk.checked,
      lowImpact: form.lowImpact.checked,
      highImpact: false,
      avoidFor: [...form.querySelectorAll('input[name=avoid]:checked')].map((i) => i.value),
      tips: form.tips.value.split('\n').map((s) => s.trim()).filter(Boolean),
      createdAt: ex?.createdAt || new Date().toISOString()
    };
    await saveCustomExercise(data);
    toast(ex ? '수정했어요' : `'${name}'을(를) 추가했어요`);
    location.hash = '#/exercises';
  });

  const del = el.querySelector('#delete');
  if (del) {
    let armed = false;
    del.addEventListener('click', async () => {
      if (!armed) { armed = true; del.textContent = '한 번 더 누르면 삭제돼요'; return; }
      const r = await deleteCustomExercise(ex.id);
      toast(r === 'deleted' ? '삭제했어요' : '기록에 쓰인 동작이라 지우지 않고 사용 안 함으로 바꿨어요', 3000);
      location.hash = '#/exercises';
    });
  }
}
