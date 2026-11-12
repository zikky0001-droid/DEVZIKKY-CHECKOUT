/* DEVZIKKY PAY — Statistics visual layer. Uses only the existing /api/stats payload. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  if (!$('statsChart')) return;
  const palette = { green:'#65f6b5', amber:'#ffd47c', pink:'#ff729c', cyan:'#63f3ff', violet:'#a78bfa', blue:'#5f91ff', magenta:'#fa70d6', muted:'#8d9bb9' };
  const charts = {};
  let latest = null;
  const number = value => Number(value || 0);
  const fmt = value => number(value).toLocaleString('en-NG');
  const money = value => `₦${number(value).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label = value => {
    const text = String(value ?? '');
    const m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[1]}/${m[2]}/${m[3]}`;
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : text;
  };
  const theme = () => document.documentElement.dataset.theme === 'light';
  const gridColor = () => theme() ? 'rgba(39,58,88,.12)' : 'rgba(141,157,185,.13)';
  const tickColor = () => theme() ? '#65738a' : '#8291ad';
  const tooltip = () => ({backgroundColor:theme()?'#ffffff':'#0c1428',titleColor:theme()?'#182236':'#f0f4ff',bodyColor:theme()?'#52617a':'#aebbd2',borderColor:theme()?'rgba(39,58,88,.2)':'rgba(99,243,255,.25)',borderWidth:1,padding:12,displayColors:true});
  function baseOptions(extra={}) {
    return {responsive:true,maintainAspectRatio:false,animation:{duration:450},interaction:{intersect:false,mode:'index'},plugins:{legend:{display:false},tooltip:tooltip(),zoom:{zoom:{wheel:{enabled:true},pinch:{enabled:true},mode:'x'},pan:{enabled:true,mode:'x'}}},scales:{x:{stacked:true,grid:{color:gridColor()},ticks:{color:tickColor(),maxRotation:0,autoSkip:true,maxTicksLimit:9,font:{size:10}},border:{display:false}},y:{stacked:true,beginAtZero:true,grid:{color:gridColor()},ticks:{color:tickColor(),precision:0,font:{size:10}},border:{display:false}}},...extra};
  }
  function draw(id, config) {
    const canvas=$(id); if (!canvas || !window.Chart) return;
    if (charts[id]) charts[id].destroy();
    charts[id]=new Chart(canvas,config);
  }
  function renderActivity(data) {
    const rows=Array.isArray(data.series)?data.series:[];
    const canvas=$('statsChart');
    if (!canvas) return;
    const stage=canvas.parentElement;
    stage?.querySelector('.stats-chart-empty-overlay')?.remove();
    if (!rows.length) {
      if(stage && !stage.querySelector('.stats-chart-empty-overlay')) { const empty=document.createElement('div'); empty.className='stats-chart-empty-overlay'; empty.textContent='No activity was recorded in this date range.'; stage.appendChild(empty); }
    }
    const labels=rows.map(row=>label(row.bucket));
    const config={type:'bar',data:{labels,datasets:[
      {label:'Successful',data:rows.map(r=>number(r.successful)),backgroundColor:'rgba(101,246,181,.82)',borderColor:palette.green,borderWidth:1,borderRadius:5,stack:'transactions'},
      {label:'Pending',data:rows.map(r=>number(r.pending)),backgroundColor:'rgba(255,212,124,.82)',borderColor:palette.amber,borderWidth:1,borderRadius:5,stack:'transactions'},
      {label:'Failed / reversed',data:rows.map(r=>number(r.failed)),backgroundColor:'rgba(255,114,156,.82)',borderColor:palette.pink,borderWidth:1,borderRadius:5,stack:'transactions'}
    ]},options:baseOptions({plugins:{...baseOptions().plugins,tooltip:{...tooltip(),callbacks:{label:ctx=>`${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`}}},scales:{x:{...baseOptions().scales.x,stacked:true},y:{...baseOptions().scales.y,stacked:true,title:{display:true,text:'Transactions',color:tickColor(),font:{size:10}}}}})};
    draw('statsChart',config);
    const valueRows=rows.map(r=>number(r.successful_ngn));
    draw('statsValueChart',{type:'line',data:{labels,datasets:[{label:'Verified value (NGN)',data:valueRows,borderColor:palette.cyan,backgroundColor:'rgba(99,243,255,.12)',fill:true,tension:.32,borderWidth:2.5,pointRadius:labels.length>35?0:3,pointHoverRadius:6,pointBackgroundColor:palette.cyan}]},options:{...baseOptions({plugins:{...baseOptions().plugins,tooltip:{...tooltip(),callbacks:{label:ctx=>money(ctx.parsed.y)}}},scales:{x:{...baseOptions().scales.x,stacked:false},y:{beginAtZero:true,grid:{color:gridColor()},ticks:{color:tickColor(),callback:value=>`₦${Number(value).toLocaleString('en-NG')}`},border:{display:false}}}}),plugins:{...baseOptions().plugins,tooltip:{...tooltip(),callbacks:{label:ctx=>money(ctx.parsed.y)}},zoom:{zoom:{wheel:{enabled:true},pinch:{enabled:true},mode:'x'},pan:{enabled:true,mode:'x'}}}}});
    const reset=$('statsZoomReset'); if(reset) reset.onclick=()=>{charts.statsChart?.resetZoom();charts.statsValueChart?.resetZoom();};
  }
  function renderStatus(data) {
    const s=data.statuses||{}; const values=[number(s.success?.count),number(s.pending?.count),number(s.failed?.count)];
    draw('statusChart',{type:'doughnut',data:{labels:['Successful','Pending','Failed / reversed'],datasets:[{data:values,backgroundColor:[palette.green,palette.amber,palette.pink],borderColor:theme()?['#fff','#fff','#fff']:['#10182b','#10182b','#10182b'],borderWidth:3,hoverOffset:8,spacing:3}]},options:{responsive:true,maintainAspectRatio:false,cutout:'72%',plugins:{legend:{display:false},tooltip:tooltip()}}});
  }
  function renderBars(id, rows, nameKey, countKey, color) {
    const top=(rows||[]).slice(0,7).reverse();
    draw(id,{type:'bar',data:{labels:top.map(r=>String(r[nameKey]||'Other')),datasets:[{label:'Successful payments',data:top.map(r=>number(r[countKey])),backgroundColor:color,borderRadius:7,maxBarThickness:22}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:tooltip()},scales:{x:{beginAtZero:true,grid:{color:gridColor()},ticks:{color:tickColor(),precision:0}},y:{grid:{display:false},ticks:{color:tickColor(),font:{size:10}}}}}});
  }
  function renderCurrency(rows) {
    const top=(rows||[]).slice(0,8);
    draw('currencyChart',{type:'doughnut',data:{labels:top.map(r=>String(r.currency||'Unknown')),datasets:[{data:top.map(r=>number(r.count)),backgroundColor:[palette.cyan,palette.violet,palette.green,palette.amber,palette.pink,palette.blue,palette.magenta,'#8da0b9'],borderColor:theme()?'#fff':'#10182b',borderWidth:2,hoverOffset:6}]},options:{responsive:true,maintainAspectRatio:false,cutout:'66%',plugins:{legend:{display:true,position:'bottom',labels:{color:tickColor(),boxWidth:8,padding:12,font:{size:9}}},tooltip:tooltip()}}});
  }
  function renderInsights(data) {
    const totals=data.totals||{}; const s=data.statuses||{};
    const success=number(s.success?.count), pending=number(s.pending?.count), failed=number(s.failed?.count), all=success+pending+failed;
    const rate=all?success/all*100:0;
    $('insightSuccessRate').textContent=all?`${rate.toFixed(1)}%`:'—';
    $('insightSuccessText').textContent=all?`${fmt(success)} successful of ${fmt(all)} recorded transactions`:'No transactions in this date range';
    $('insightSuccessTrack').style.width=`${Math.max(0,Math.min(100,rate))}%`;
    const totalValue=number(totals.total_ngn);
    $('insightAverageValue').textContent=success?money(totalValue/success):'—';
    const types=(data.by_type||[]).slice().sort((a,b)=>number(b.total_ngn)-number(a.total_ngn));
    $('insightTopType').textContent=types[0]?.type||'—';
    $('insightTopTypeText').textContent=types[0]?`${money(types[0].total_ngn)} verified value`:'No verified payment types';
    const series=data.series||[]; const busiest=series.slice().sort((a,b)=>number(b.total)-number(a.total))[0];
    $('insightBusiestPeriod').textContent=busiest?label(busiest.bucket):'—';
    $('insightBusiestText').textContent=busiest?`${fmt(busiest.total)} transactions in this period`:'No activity recorded';
    const window=data.window||{}; $('statsInsightWindow').textContent=window.from&&window.to?`${window.from} — ${window.to}`:'SELECTED WINDOW';
  }
  function renderActivityMap(data) {
    const root=$('statsActivityMap'); if(!root)return;
    const rows=data.series||[];
    if(!rows.length){root.innerHTML='<span class="stats-empty">No activity in the selected window.</span>';return;}
    const max=Math.max(1,...rows.map(r=>number(r.total)));
    root.innerHTML=rows.map(row=>{
      const value=number(row.total); const ratio=value/max; const level=value===0?0:ratio<.25?1:ratio<.5?2:ratio<.75?3:4;
      const bucket=label(row.bucket);
      return `<div class="stats-activity-tile level-${level}" title="${escape(bucket)} · ${fmt(value)} transactions"><span>${escape(bucket)}</span><strong>${fmt(value)}</strong></div>`;
    }).join('');
  }
  function update(data) {
    if(!data||!data.totals)return; latest=data;
    renderActivity(data); renderStatus(data); renderBars('typeChart',data.by_type||[],'type','count','rgba(167,139,250,.82)'); renderCurrency(data.by_currency||[]); renderInsights(data); renderActivityMap(data);
  }
  window.addEventListener('dz:stats-updated',event=>update(event.detail));
  // The main page loader may dispatch before this deferred module is evaluated on slow devices.
  if(latest) update(latest);
  window.addEventListener('themechange',()=>{if(latest)update(latest);});
  document.querySelectorAll('[data-chart-expand]').forEach(button=>button.addEventListener('click',()=>{
    const panel=button.closest('.stats-panel'); if(!panel)return;
    const expanded=panel.classList.toggle('is-chart-expanded');
    button.textContent=expanded?'Close expanded view':'Expand ↗';
    document.body.classList.toggle('stats-chart-modal-open',expanded);
    setTimeout(()=>Object.values(charts).forEach(chart=>chart.resize()),80);
  }));
})();
