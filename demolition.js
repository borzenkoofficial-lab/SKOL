(() => {
  const form = document.querySelector('#demolition-form');
  if (!form) return;
  const $ = id => document.getElementById(id);
  const work = $('dem-work');
  const area = $('dem-area');
  const material = $('dem-material');
  const thickness = $('dem-thickness');
  const workNames = {
    walls: 'Стены и перегородки',
    screed: 'Стяжка пола',
    coverings: 'Плитка и напольные покрытия',
    ceiling: 'Потолки и старая отделка',
    complex: 'Комплексный демонтаж',
    other: 'Другой вид работ'
  };
  const materialOptions = {
    walls: [['unknown','Нужно уточнить'],['brick','Кирпич'],['block','Блок'],['gypsum','Гипсовая перегородка'],['concrete','Бетон'],['other','Другое']],
    screed: [['unknown','Нужно уточнить'],['cement','Цементно-песчаная стяжка'],['concrete','Бетон'],['other','Другое']],
    coverings: [['unknown','Нужно уточнить'],['tile','Керамическая плитка'],['laminate','Ламинат / линолеум'],['other','Другое']],
    ceiling: [['unknown','Нужно уточнить'],['suspended','Подвесная конструкция'],['gypsum','Гипсовая облицовка'],['other','Другое']],
    complex: [['unknown','Нужно уточнить'],['other','Несколько типов конструкций']],
    other: [['unknown','Нужно уточнить'],['other','Другое']]
  };
  const materialField = $('dem-material-field');
  const thicknessField = $('dem-thickness-field');
  const updateMaterialOptions = () => {
    const current = material.value;
    material.innerHTML = '';
    (materialOptions[work.value] || materialOptions.other).forEach(([value,label]) => {
      const option = document.createElement('option');
      option.value = value; option.textContent = label; material.appendChild(option);
    });
    if ([...material.options].some(option => option.value === current)) material.value = current;
    else material.value = 'unknown';
    materialField.hidden = work.value === 'complex' || work.value === 'other';
    thicknessField.hidden = work.value === 'coverings' || work.value === 'other';
  };
  const updateSummary = () => {
    const rawArea = Number(area.value);
    const validArea = Number.isFinite(rawArea) && rawArea > 0;
    $('dem-summary-area').innerHTML = validArea ? new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(rawArea) + ' <small>м²</small>' : '— <small>м²</small>';
    $('dem-summary-work').textContent = workNames[work.value] || 'Выберите вид работ';
    const t = Number(thickness.value);
    const thicknessKnown = thickness.value !== '' && Number.isFinite(t) && t > 0;
    const isVolumeWork = work.value === 'screed' || work.value === 'walls';
    if (validArea && isVolumeWork && thicknessKnown) {
      const volume = rawArea * t / 100;
      $('dem-summary-volume').textContent = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(volume) + ' м³*';
    } else if (validArea) {
      $('dem-summary-volume').textContent = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(rawArea) + ' м²';
    } else {
      $('dem-summary-volume').textContent = 'Будет рассчитан';
    }
  };
  work.addEventListener('change', () => { updateMaterialOptions(); updateSummary(); });
  [area, material, thickness, $('dem-floor'), $('dem-elevator'), $('dem-waste'), $('dem-object'), $('dem-notes')].forEach(el => el.addEventListener('input', updateSummary));
  updateMaterialOptions();
  updateSummary();
  document.querySelectorAll('[data-work]').forEach(card => card.addEventListener('click', () => {
    work.value = card.dataset.work;
    updateMaterialOptions();
    updateSummary();
  }));
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const val = id => String($(id).value || '').trim();
    const areaValue = val('dem-area');
    const thicknessValue = val('dem-thickness');
    const volume = Number(areaValue) * Number(thicknessValue) / 100;
    const volumeLine = (val('dem-work') === 'screed' || val('dem-work') === 'walls') && thicknessValue && Number.isFinite(volume) && volume > 0
      ? 'Расчётный геометрический объём: ' + new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(volume) + ' м³ (ориентир, без учёта неоднородности конструкции).\n'
      : '';
    const body = [
      'Здравствуйте! Хочу запросить расчёт демонтажных работ в СКОЛ.',
      '',
      'Вид работ: ' + (workNames[val('dem-work')] || val('dem-work')),
      'Площадь: ' + areaValue + ' м²',
      'Материал / конструкция: ' + (material.options[material.selectedIndex]?.text || 'Не указано'),
      'Толщина: ' + (thicknessValue ? thicknessValue + ' см' : 'Не указана'),
      'Этаж: ' + (val('dem-floor') || 'Не указан'),
      'Лифт: ' + ($('dem-elevator').selectedOptions[0]?.text || 'Не указано'),
      'Вынос / вывоз: ' + ($('dem-waste').selectedOptions[0]?.text || 'Не указано'),
      'Тип объекта: ' + val('dem-object'),
      volumeLine,
      'Комментарий: ' + (val('dem-notes') || 'Не указан'),
      '',
      'Прошу уточнить состав работ и подготовить смету.'
    ].join('\n');
    $('dem-form-status').textContent = 'Подготовлено письмо с параметрами заявки. Проверьте его и отправьте из почтовой программы.';
    window.location.href = 'mailto:borzenko.official@yandex.ru?subject=' + encodeURIComponent('Запрос расчёта демонтажа — СКОЛ') + '&body=' + encodeURIComponent(body);
  });
})();