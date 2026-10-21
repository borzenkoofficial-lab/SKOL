(() => {
  const scene = document.querySelector('#room-scene');
  if (!scene) return;
  const labels = {
    floor: 'Пол',
    ceiling: 'Потолок',
    left: 'Левая стена',
    right: 'Правая стена',
    partition: 'Перегородка',
    door: 'Дверной проём',
    window: 'Окно'
  };
  const defaults = {floor:true,ceiling:true,left:true,right:true,partition:false,door:true,window:true};
  const inputs = [...document.querySelectorAll('[data-element]')];
  const task = document.querySelector('#room-task');
  const type = document.querySelector('#room-type');
  const length = document.querySelector('#room-length');
  const width = document.querySelector('#room-width');
  const height = document.querySelector('#room-height');
  const feedback = document.querySelector('#summary-feedback');
  const selectedCount = document.querySelector('#selected-count');
  const sendBrief = document.querySelector('#send-brief');
  const number = (field) => {
    const n = Number(field.value);
    return Number.isFinite(n) && n > 0 ? Math.min(n, Number(field.max) || 100) : 0;
  };
  const fmt = (n) => new Intl.NumberFormat('ru-RU', {maximumFractionDigits:2}).format(n);
  const checkedNames = () => inputs.filter(input => input.checked).map(input => labels[input.dataset.element]);
  function update() {
    inputs.forEach(input => scene.dataset[input.dataset.element] = String(input.checked));
    const chosen = checkedNames();
    selectedCount.textContent = chosen.length;
    const l=number(length), w=number(width), h=number(height);
    const area=l*w, volume=area*h;
    document.querySelector('#floor-area').textContent=fmt(area);
    document.querySelector('#room-volume').textContent=fmt(volume);
    document.querySelector('#brief-task').textContent=task.value;
    document.querySelector('#brief-type').textContent=type.value;
    document.querySelector('#brief-dimensions').textContent=[l,w,h].map(fmt).join(' × ')+' м';
    document.querySelector('#brief-area').textContent=fmt(area)+' м²';
    document.querySelector('#brief-elements').textContent=chosen.length ? chosen.join(', ') : 'Элементы пока не выбраны';
    const brief = getBrief();
    sendBrief.href = 'index.html#contact';
    sendBrief.dataset.brief = brief;
    feedback.textContent='Описание обновлено. Скопируйте его или используйте как основу для обращения.';
  }
  function getBrief() {
    const chosen=checkedNames();
    return [
      'СКОЛ — исходные данные по объекту',
      'Тип задачи: '+task.value,
      'Тип помещения: '+type.value,
      'Примерные размеры (Д × Ш × В): '+[number(length),number(width),number(height)].map(fmt).join(' × ')+' м',
      'Площадь пола: '+fmt(number(length)*number(width))+' м²',
      'Объём помещения: '+fmt(number(length)*number(width)*number(height))+' м³',
      'Отмеченные элементы: '+(chosen.length ? chosen.join(', ') : 'не выбраны'),
      'Примечание: параметры предварительные; стоимость и объём требуют уточнения по объекту.'
    ].join('\n');
  }
  inputs.forEach(input=>input.addEventListener('change',update));
  [task,type,length,width,height].forEach(field=>field.addEventListener('input',update));
  document.querySelector('#reset-scene').addEventListener('click',()=>{
    inputs.forEach(input=>input.checked=defaults[input.dataset.element]);
    task.value='Демонтаж';type.selectedIndex=0;length.value='5';width.value='4';height.value='2.8';
    update();feedback.textContent='Схема возвращена к исходным настройкам.';
  });
  document.querySelector('#copy-brief').addEventListener('click',async()=>{
    try {
      await navigator.clipboard.writeText(getBrief());
      feedback.textContent='Описание скопировано. Его можно вставить в сообщение или заявку.';
    } catch {
      const area=document.createElement('textarea');
      area.value=getBrief();area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';
      document.body.append(area);area.select();
      const ok=document.execCommand('copy');area.remove();
      feedback.textContent=ok?'Описание скопировано. Его можно вставить в сообщение или заявку.':'Не удалось скопировать автоматически. Выделите текст описания вручную.';
    }
  });
  update();
})();