const $ = s => document.querySelector(s);
const money = (n, code="NGN") => new Intl.NumberFormat(undefined,{style:"currency",currency:code,maximumFractionDigits:2}).format(Number(n)||0);
async function api(path, options={}) {
  const r=await fetch("/api/"+path,{credentials:"same-origin",...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
  const data=await r.json().catch(()=>({error:"Unexpected server response"}));
  if(!r.ok) throw new Error(data.error||"Request failed");
  return data;
}
async function loadRates(){
  const d=await api("rates");
  window.__dzRates=d;
  return d;
}
async function checkoutPage(){
  const form=$("#checkoutForm"); if(!form)return;
  const currency=$("#currency"), estimate=$("#estimate");
  let rateData=null;
  try{
    rateData=await loadRates();
    currency.innerHTML=Object.keys(rateData.rates).sort((a,b)=>a==="NGN"?-1:b==="NGN"?1:a.localeCompare(b))
      .map(c=>`<option value="${c}">${c}</option>`).join("");
  }catch(e){$("#message").textContent="Rates are temporarily unavailable. Please try again shortly.";return;}
  const update=()=>{
    const code=currency.value, amount=Number(form.elements.amount.value);
    const rate=Number(rateData.rates[code]);
    $("#currencyHint").textContent=code;
    if(amount>0&&rate>0) estimate.textContent=`Estimated charge: ${money(code==="NGN"?amount:amount*rate,"NGN")} · Rate date: ${rateData.date} · ${rateData.source}`;
    else estimate.textContent=`Rate date: ${rateData.date} · ${rateData.source}`;
  };
  currency.addEventListener("change",update);form.elements.amount.addEventListener("input",update);
  form.addEventListener("submit",async e=>{
    e.preventDefault();const btn=$("#payButton");btn.disabled=true;$("#message").textContent="Preparing secure checkout…";
    try{
      const b=Object.fromEntries(new FormData(form));
      const result=await api("pay/initialize",{method:"POST",body:JSON.stringify(b)});
      location.href=result.authorization_url;
    }catch(err){$("#message").textContent=err.message;btn.disabled=false;}
  });
  const params=new URLSearchParams(location.search),ref=params.get("reference");
  if(ref){$("#paymentResult").classList.remove("hidden");$("#verifyMessage").textContent="Verifying payment…";
    try{const result=await api("pay/verify?reference="+encodeURIComponent(ref));$("#verifyMessage").textContent=result.status==="success"?"Payment verified successfully. Thank you!":`Payment status: ${result.status}.`; }
    catch(e){$("#verifyMessage").textContent="We could not verify this payment yet. Please contact support with your payment reference.";}}
}
async function statsPage(){
  if(!$("#total"))return;
  try{const d=await api("stats");$("#total").textContent=money(d.totals.total_ngn);$("#count").textContent=d.totals.successful;
    $("#currencies").innerHTML=table(["Currency","Successful payments","Original total"],d.by_currency.map(x=>[x.currency,x.count,money(x.total,x.currency)]));
    $("#recent").innerHTML=table(["Reference","Amount (NGN)","Type","Date"],d.recent.map(x=>[x.reference,money(x.amount_ngn),x.type,new Date(x.created_at).toLocaleDateString()]));}
  catch(e){$("#total").textContent="Unavailable";$("#currencies").textContent=e.message;}
}
function table(headers,rows){return `<table><thead><tr>${headers.map(x=>`<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(x=>`<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function adminPage(){
 const login=$("#loginForm");if(!login)return;
 login.addEventListener("submit",async e=>{e.preventDefault();$("#loginMessage").textContent="Signing in…";
  try{await api("admin/login",{method:"POST",body:JSON.stringify({key:login.elements.key.value})});login.reset();await showAdmin();}
  catch(err){$("#loginMessage").textContent=err.message;}});
 $("#logout").addEventListener("click",async()=>{await api("admin/logout",{method:"POST",body:"{}"});$("#adminPanel").classList.add("hidden");$("#loginPanel").classList.remove("hidden");});
 await showAdmin(true);
}
async function showAdmin(quiet=false){
 try{const d=await api("admin/transactions");$("#adminRows").innerHTML=table(["Ref","Name","Email","NGN","Original","Type","Source","Status","Created"],d.transactions.map(x=>[x.reference,x.name,x.email,money(x.amount_ngn),`${x.original_amount} ${x.original_currency}`,x.type,x.source,x.status,new Date(x.created_at).toLocaleString()]));
 $("#loginPanel").classList.add("hidden");$("#adminPanel").classList.remove("hidden");}
 catch(e){if(!quiet){$("#loginMessage").textContent=e.message;}}
}
checkoutPage();statsPage();adminPage();