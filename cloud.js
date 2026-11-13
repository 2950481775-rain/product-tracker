(() => {
  const config = window.TRACKER_CLOUD;
  const origin = config.url.trim().replace(/\/$/, '');
  const key = config.publishableKey.trim();
  const ready = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(origin) && /^sb_publishable_[\w-]+$/.test(key);
  let session;
  try { session = JSON.parse(sessionStorage.getItem('tracker-cloud-session:'+origin)); } catch {}
  const save = value => {
    session = value;
    if (value) sessionStorage.setItem('tracker-cloud-session:'+origin,JSON.stringify(value));
    else sessionStorage.removeItem('tracker-cloud-session:'+origin);
  };
  const request = (path, options = {}, token) => fetch(origin + path, {
    ...options, cache:'no-store', signal:AbortSignal.timeout(20000),
    headers:{apikey:key,'Content-Type':'application/json',...options.headers,...(token?{Authorization:'Bearer '+token}:{})}
  });
  async function authenticate(grant, body) {
    const response = await request('/auth/v1/token?grant_type='+grant,{method:'POST',body:JSON.stringify(body)});
    if (!response.ok) throw Error('登录失败或会话已过期，请检查账户信息后重新登录。');
    const data = await response.json();
    save({...data,expires_at:Math.floor(Date.now()/1000)+data.expires_in});
  }
  window.cloudApi = async (url, options={}) => {
    if (!ready || !session) throw Error('请先配置 Supabase 并登录。');
    if (session.expires_at < Date.now()/1000+30) {
      try { await authenticate('refresh_token',{refresh_token:session.refresh_token}); }
      catch(e) { save(null); document.querySelector('#cloud-login').hidden=false; throw e; }
    }
    const respond = (data,status=200) => new Response(JSON.stringify(data),{status});
    const base='/rest/v1/tracker_state?id=eq.1';
    if(options.method==='PUT'){
      const {revision,products}=JSON.parse(options.body);
      const response=await request(base+'&revision=eq.'+revision+'&select=revision',{
        method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({revision:revision+1,products})
      },session.access_token);
      if(!response.ok)return respond({error:'云端保存失败，请检查项目权限或数据大小。'},response.status);
      const rows=await response.json();
      return rows.length?respond(rows[0]):respond({error:'云端版本已变化或没有写入权限。'},409);
    }
    const revision=new URL(url,location.href).searchParams.get('revision');
    const response=await request(base+'&select=revision',{},session.access_token);
    if(!response.ok)return response;
    const [head]=await response.json();
    if(!head)return respond({error:'此账号未获得工作台权限。'},403);
    if(String(head.revision)===revision)return new Response(null,{status:204});
    const full=await request(base+'&select=revision,products',{},session.access_token);
    if(!full.ok)return full;
    const [state]=await full.json();
    return state?respond({version:1,...state}):respond({error:'此账号未获得工作台权限。'},403);
  };
  document.addEventListener('DOMContentLoaded',()=>{
    const form=document.querySelector('#cloud-login');
    const message=document.querySelector('#cloud-message');
    form.hidden=Boolean(ready&&session);
    if(!ready){message.textContent='站点尚未配置 Supabase 项目地址和公开密钥。';form.querySelector('button').disabled=true;}
    form.onsubmit=async e=>{
      e.preventDefault();const button=form.querySelector('button');button.disabled=true;
      try{await authenticate('password',{email:form.elements.email.value,password:form.elements.password.value});form.reset();form.hidden=true;window.trackerCloudConnect();}
      catch(err){message.textContent=err.message;}
      finally{button.disabled=false;}
    };
    document.querySelector('#cloud-logout').onclick=async ()=>{
      if(!window.trackerCloudCanLeave())return;
      if(session)try{await request('/auth/v1/logout?scope=local',{method:'POST'},session.access_token)}catch{}
      save(null);location.reload();
    };
  });
  window.trackerCloudHasSession=()=>Boolean(ready&&session);
})();
