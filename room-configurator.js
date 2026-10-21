(() => {
  const scene=document.querySelector('#room-scene');
  if(!scene)return;
  const labels={floor:'Напольное покрытие',ceiling:'Потолочная отделка',left:'Отделка стен',right:'Правая стена',partition:'Межкомнатные перегородки',door:'Межкомнатная дверь',window:'Окно и откосы',furniture:'Мебель / встроенный гарнитур',plumbing:'Сантехника',electric:'Розетки и освещение'};
  const defaults={floor:true,ceiling:true,left:true,right:true,partition:false,door:true,window:true,furniture:true,plumbing:false,electric:true};
  const roomNames={living:'Гостиная',bedroom:'Спальня',kitchen:'Кухня',bathroom:'Ванная / санузел',hallway:'Прихожая',whole:'Вся квартира'};
  const roomNotes={living:'Стены, пол, потолок, двери, окна и мебель гостиной.',bedroom:'Напольное покрытие, отделка, встроенные шкафы и дверные блоки.',kitchen:'Фартук, гарнитур, пол, стены, сантехнические и электрические точки.',bathroom:'Плитка, гидроизоляция, сантехника, потолок и инженерные точки.',hallway:'Пол, стены, входная зона, шкафы и межкомнатные двери.',whole:'Общий перечень работ по квартире. Уточняйте объёмы по каждой комнате отдельно.'};
  const finishNames={wall:{paint:'окраска',wallpaper:'обои',tile:'керамическая плитка',concrete:'бетон / под покраску'},floor:{wood:'паркет / ламинат',tile:'керамогранит / плитка',concrete:'стяжка / бетон',vinyl:'винил'},ceiling:{white:'окраска / штукатурка',stretch:'натяжной потолок',suspended:'подвесной потолок',raw:'черновой потолок'}};
  const inputs=[...document.querySelectorAll('[data-element]')];
  const task=document.querySelector('#room-task'),room=document.querySelector('#room-type');
  const wallFinish=document.querySelector('#wall-finish'),floorFinish=document.querySelector('#floor-finish'),ceilingFinish=document.querySelector('#ceiling-finish');
  const showFurniture=document.querySelector('#show-furniture');
  const length=document.querySelector('#room-length'),width=document.querySelector('#room-width'),height=document.querySelector('#room-height');
  const feedback=document.querySelector('#summary-feedback'),count=document.querySelector('#selected-count');
  const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n);
  const number=field=>{const n=Number(field.value);return Number.isFinite(n)&&n>0?Math.min(n,Number(field.max)||100):0};
  const chosen=()=>inputs.filter(i=>i.checked).map(i=>labels[i.dataset.element]||i.dataset.element);
  function syncScene(){
    inputs.forEach(i=>scene.dataset[i.dataset.element]=String(i.checked));
    scene.dataset.room=room.value;
    scene.dataset.wallFinish=wallFinish.value;
    scene.dataset.floorFinish=floorFinish.value;
    scene.dataset.ceilingFinish=ceilingFinish.value;
    scene.dataset.furniture=String(showFurniture.checked);
    document.querySelector('#scene-room-label').textContent=roomNames[room.value].toLocaleUpperCase('ru-RU')+' · ПРИМЕР ИНТЕРЬЕРА';
    document.querySelector('#room-preset-note').textContent=roomNotes[room.value];
    count.textContent=inputs.filter(i=>i.checked).length+(showFurniture.checked?1:0);
  }
  function briefText(){
    const l=number(length),w=number(width),h=number(height),names=chosen();
    return [
      'СКОЛ — исходные данные по объекту',
      'Тип задачи: '+task.value,
      'Помещение: '+roomNames[room.value],
      'Примерные размеры (Д × Ш × В): '+[l,w,h].map(fmt).join(' × ')+' м',
      'Площадь пола: '+fmt(l*w)+' м²',
      'Объём помещения: '+fmt(l*w*h)+' м³',
      'Выбранная отделка: стены — '+finishNames.wall[wallFinish.value]+'; пол — '+finishNames.floor[floorFinish.value]+'; потолок — '+finishNames.ceiling[ceilingFinish.value],
      'Элементы / направления работ: '+(names.length?names.join(', '):'не выбраны'),
      'Мебель отображать в схеме: '+(showFurniture.checked?'да':'нет'),
      'Примечание: схема предварительная, стоимость и объёмы требуют уточнения после осмотра.'
    ].join('\n');
  }
  function update(){
    syncScene();
    const l=number(length),w=number(width),h=number(height);
    document.querySelector('#floor-area').textContent=fmt(l*w);
    document.querySelector('#room-volume').textContent=fmt(l*w*h);
    document.querySelector('#brief-task').textContent=task.value;
    document.querySelector('#brief-type').textContent=roomNames[room.value];
    document.querySelector('#brief-dimensions').textContent=[l,w,h].map(fmt).join(' × ')+' м';
    document.querySelector('#brief-area').textContent=fmt(l*w)+' м²';
    document.querySelector('#brief-elements').textContent=chosen().join(', ')||'Элементы пока не выбраны';
    document.querySelector('#brief-finishes').textContent='Стены: '+finishNames.wall[wallFinish.value]+'; пол: '+finishNames.floor[floorFinish.value]+'; потолок: '+finishNames.ceiling[ceilingFinish.value];
    document.querySelector('#send-brief').dataset.brief=briefText();
    feedback.textContent='Описание обновлено. Скопируйте его, чтобы передать параметры специалисту.';
  }
  inputs.forEach(i=>i.addEventListener('change',update));
  [task,room,wallFinish,floorFinish,ceilingFinish,length,width,height,showFurniture].forEach(el=>el.addEventListener('input',update));
  document.querySelector('#reset-scene').addEventListener('click',()=>{
    inputs.forEach(i=>i.checked=defaults[i.dataset.element]===true);
    task.value='Демонтаж';room.value='living';wallFinish.value='paint';floorFinish.value='wood';ceilingFinish.value='white';showFurniture.checked=true;
    length.value='5';width.value='4';height.value='2.8';update();feedback.textContent='Настройки возвращены к исходному интерьеру.';
  });
  document.querySelector('#copy-brief').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(briefText());feedback.textContent='Описание скопировано. Его можно вставить в сообщение подрядчику.'}
    catch{const area=document.createElement('textarea');area.value=briefText();area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();const ok=document.execCommand('copy');area.remove();feedback.textContent=ok?'Описание скопировано.':'Не удалось скопировать автоматически. Попробуйте ещё раз.'}
  });
  update();
})();