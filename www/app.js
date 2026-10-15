(() => {
  const $ = (s) => document.querySelector(s);
  const authScreen = $('#authScreen'), appScreen = $('#appScreen');
  const config = window.MADRESEYAR_FIREBASE_CONFIG || {};
  const configured = config.apiKey && !config.apiKey.startsWith('YOUR_') && config.projectId && !config.projectId.startsWith('YOUR_');
  let auth, db, functions, currentUser = null, profile = null, activePage = 'home', unsubscribers = [], messageUnsub = null, activeConversationId = null, renderedConversationId = null;
  const roles = { admin: 'مدیر مدرسه', teacher: 'معلم', student: 'دانش‌آموز' };
  const emailFor = username => `${String(username).trim().toLowerCase()}@madreseyar.app`;
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const faDate = value => { try { return new Intl.DateTimeFormat('fa-IR',{year:'numeric',month:'long',day:'numeric'}).format(value?.toDate ? value.toDate() : new Date(value)); } catch { return ''; } };
  function setMessage(el, text, error=false) { el.textContent = text; el.style.color = error ? '#c0392b' : '#16865e'; }
  function showAuth() { authScreen.classList.remove('hidden'); appScreen.classList.add('hidden'); }
  function showApp() { authScreen.classList.add('hidden'); appScreen.classList.remove('hidden'); }
  function clearSubscriptions() { unsubscribers.forEach(fn => { try { fn(); } catch {} }); unsubscribers = []; if (messageUnsub) { try { messageUnsub(); } catch {} messageUnsub = null; } renderedConversationId = null; }
  function openSetup() { $('#loginForm').classList.add('hidden'); $('#setupForm').classList.remove('hidden'); $('#authTitle').textContent='راه‌اندازی مدیر اصلی'; $('#authHint').textContent='حساب مدیر فقط با کد یک‌بارمصرف سرور ساخته می‌شود.'; $('#setupToggle').textContent='بازگشت به ورود'; $('#authMessage').textContent=''; }
  function openLogin() { $('#setupForm').classList.add('hidden'); $('#loginForm').classList.remove('hidden'); $('#authTitle').textContent='ورود به مدرسه‌یار'; $('#authHint').textContent='نام کاربری و رمز عبورت را وارد کن.'; $('#setupToggle').textContent='راه‌اندازی اولیه مدیر'; $('#authMessage').textContent=''; }
  function initFirebase() {
    if (!configured || !window.firebase) { $('#configWarning').classList.remove('hidden'); $('#loginForm').querySelector('button').disabled=true; $('#setupToggle').disabled=true; return false; }
    try { firebase.initializeApp(config); auth=firebase.auth(); db=firebase.firestore(); functions=firebase.app().functions('us-central1'); auth.onAuthStateChanged(async user => { if (!user) { clearSubscriptions(); currentUser=null; profile=null; showAuth(); return; } currentUser=user; try { const snap=await db.collection('users').doc(user.uid).get(); if (!snap.exists) throw new Error('پروفایل این حساب پیدا نشد؛ مدیر مدرسه باید حساب را بررسی کند.'); profile=snap.data(); if (!roles[profile.role]) throw new Error('نقش حساب معتبر نیست.'); showApp(); renderShell(); loadPage(activePage); } catch (e) { await auth.signOut(); setMessage($('#authMessage'), friendlyError(e), true); } }); return true; }
    catch (e) { setMessage($('#authMessage'), 'راه‌اندازی Firebase ناموفق بود: '+friendlyError(e), true); return false; }
  }
  function friendlyError(e) {
    const code=e?.code || ''; const map={ 'auth/invalid-credential':'نام کاربری یا رمز عبور اشتباه است.','auth/user-not-found':'حسابی با این نام کاربری پیدا نشد.','auth/wrong-password':'رمز عبور اشتباه است.','auth/too-many-requests':'تلاش‌های زیادی انجام شده؛ کمی بعد دوباره امتحان کن.','functions/permission-denied':'دسترسی کافی برای این عملیات نداری.','functions/already-exists':'این نام کاربری قبلاً استفاده شده است.','functions/failed-precondition':'راه‌اندازی قبلاً انجام شده یا پیش‌شرط برقرار نیست.','functions/unauthenticated':'برای این کار باید وارد حساب شوی.','functions/invalid-argument':'اطلاعات واردشده معتبر نیست.','auth/email-already-in-use':'این نام کاربری قبلاً استفاده شده است.'}; return map[code] || e?.message || 'خطای ناشناخته رخ داد.';
  }
  $('#setupToggle').addEventListener('click',()=>$('#setupForm').classList.contains('hidden')?openSetup():openLogin());
  $('#loginForm').addEventListener('submit', async e => { e.preventDefault(); if(!auth) return; const button=e.submitter; button.disabled=true; setMessage($('#authMessage'),'در حال ورود…'); try { await auth.signInWithEmailAndPassword(emailFor($('#loginUsername').value),$('#loginPassword').value); } catch(err) { setMessage($('#authMessage'),friendlyError(err),true); } finally { button.disabled=false; } });
  $('#setupForm').addEventListener('submit', async e => { e.preventDefault(); if(!functions) return; const button=e.submitter; button.disabled=true; setMessage($('#authMessage'),'در حال ساخت حساب مدیر…'); try { const result=await functions.httpsCallable('bootstrapAdmin')({name:$('#adminName').value.trim(),username:$('#adminUsername').value.trim(),password:$('#adminPassword').value,secret:$('#bootstrapSecret').value}); setMessage($('#authMessage'),'حساب مدیر ساخته شد. اکنون در حال ورود…'); await auth.signInWithEmailAndPassword(emailFor($('#adminUsername').value),$('#adminPassword').value); } catch(err) { setMessage($('#authMessage'),friendlyError(err),true); } finally { button.disabled=false; } });
  $('#logoutBtn').addEventListener('click',()=>auth?.signOut()); $('#closeNotice').addEventListener('click',()=>$('#welcomeBanner').classList.add('hidden'));
  $('#nav').addEventListener('click',e=>{ const btn=e.target.closest('[data-page]'); if(!btn) return; activePage=btn.dataset.page; loadPage(activePage); });
  $('#mainAction').addEventListener('click',()=>{ if(activePage==='messages') openStartConversation(); else if(profile?.role==='admin' && activePage==='users') openCreateUser(); else if(activePage==='announcements') openCreateContent('announcement'); else openCreateContent('assignment'); });
  function renderShell() {
    $('#userBadge').textContent=`${profile.displayName || profile.username} · ${roles[profile.role]}`; $('#rolePill').textContent=roles[profile.role]; $('#greeting').textContent=`سلام ${profile.displayName || profile.username} عزیز 👋`; $('#todayLabel').textContent=faDate(new Date());
    $('#subtitle').textContent=profile.role==='admin'?'حساب‌ها و اطلاعیه‌های مدرسه را مدیریت کن.':profile.role==='teacher'?'تکالیف و اطلاعیه‌های کلاس را مدیریت کن.':'تکالیف و اطلاعیه‌های مدرسه را دنبال کن.';
    document.querySelectorAll('[data-role="admin"]').forEach(el=>el.classList.toggle('hidden',profile.role!=='admin'));
    $('#mainAction').textContent=activePage==='messages'?'＋ گفتگوی جدید':profile.role==='admin'&&activePage==='users'?'＋ ساخت حساب کاربر':activePage==='announcements'?'＋ انتشار اطلاعیه':'＋ ایجاد تکلیف'; $('#mainAction').classList.toggle('hidden', (profile.role==='student' && activePage!=='messages') || (activePage==='users' && profile.role!=='admin')); $('#welcomeBanner').classList.toggle('hidden', activePage==='messages');
    $('#connectionStatus').textContent='Firebase';
  }
  function loadPage(page) {
    if(!profile) return; clearSubscriptions(); activePage=page; renderShell(); document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===page));
    const titles={home:'نمای کلی',tasks:'تکالیف',announcements:'اطلاعیه‌ها',messages:'پیام‌رسان داخلی',users:'مدیریت کاربران'}; $('#mainTitle').textContent=titles[page]||'نمای کلی'; $('#sectionDescription').textContent=page==='users'?'حساب‌های معلم و دانش‌آموز را بساز و مدیریت کن.':'اطلاعات از پایگاه داده آنلاین دریافت می‌شود.';
    if(page==='users' && profile.role!=='admin'){ page='home'; activePage='home'; }
    if(page==='users') loadUsers(); else if(page==='tasks') loadCollection('assignments','تکالیف','assignment'); else if(page==='announcements') loadCollection('announcements','اطلاعیه‌ها','announcement'); else if(page==='messages') loadMessages(); else loadHome();
  }
  function renderStats(items) { $('#stats').innerHTML=items.map(x=>`<div class="stat-card"><div class="stat-top"><span>${safe(x[0])}</span><span class="stat-icon">${safe(x[2])}</span></div><div class="stat-num">${safe(x[1])}</div><div class="stat-foot">${safe(x[3])}</div></div>`).join(''); }
  function panel(title,desc,body) { return `<div class="panel"><div class="panel-head"><div><h3>${safe(title)}</h3><p class="muted">${safe(desc)}</p></div></div>${body}</div>`; }
  function loadHome() {
    renderStats([['نقش حساب',roles[profile.role],'♙','دسترسی بر اساس نقش'],['وضعیت اتصال','آنلاین','☁','Firebase فعال'],['فعالیت‌ها','…','✓','در حال دریافت'],['مدرسه','مدرسه شما','🏫','سامانه مدرسه‌یار']]);
    $('#dynamicContent').innerHTML=panel('تکالیف اخیر','موارد ثبت‌شده در سامانه','<div id="homeTasks" class="empty">در حال دریافت…</div>')+panel('اطلاعیه‌های اخیر','آخرین پیام‌های مدرسه','<div id="homeAnnouncements" class="empty">در حال دریافت…</div>');
    const sub1=db.collection('assignments').orderBy('createdAt','desc').limit(5).onSnapshot(s=>{ $('#homeTasks').innerHTML=s.empty?'<p class="empty">هنوز تکلیفی ثبت نشده است.</p>':s.docs.map(d=>itemRow(d.data(),'assignment')).join(''); },e=>$('#homeTasks').textContent=friendlyError(e));
    const sub2=db.collection('announcements').orderBy('createdAt','desc').limit(5).onSnapshot(s=>{ $('#homeAnnouncements').innerHTML=s.empty?'<p class="empty">هنوز اطلاعیه‌ای ثبت نشده است.</p>':s.docs.map(d=>itemRow(d.data(),'announcement')).join(''); },e=>$('#homeAnnouncements').textContent=friendlyError(e)); unsubscribers.push(sub1,sub2);
  }
  function itemRow(d,type) { const date=d.createdAt?faDate(d.createdAt):'تازه ثبت‌شده'; return `<div class="task-row"><div class="task-symbol">${type==='assignment'?'📝':'📣'}</div><div class="task-info"><b>${safe(d.title)}</b><small>${safe(d.description||'بدون توضیحات')}</small><small>${safe(d.authorName||'مدرسه')} · ${safe(date)}</small></div></div>`; }
  function loadCollection(collection,title,type) {
    renderStats([[title,'…',type==='assignment'?'📝':'📣','در حال بارگذاری'],['حساب',roles[profile.role],'♙','دسترسی فعلی']]); $('#dynamicContent').innerHTML=panel(title,'محتوای منتشرشده','<div id="collectionItems" class="empty">در حال دریافت…</div>');
    const unsub=db.collection(collection).orderBy('createdAt','desc').limit(100).onSnapshot(s=>{ renderStats([[title,String(s.size),type==='assignment'?'📝':'📣','مورد ثبت‌شده'],['حساب',roles[profile.role],'♙','دسترسی فعلی']]); $('#collectionItems').innerHTML=s.empty?'<p class="empty">موردی ثبت نشده است.</p>':s.docs.map(d=>itemRow(d.data(),type)).join(''); },e=>$('#collectionItems').textContent=friendlyError(e)); unsubscribers.push(unsub);
  }
  function loadUsers() {
    renderStats([['نقش شما','مدیر','♙','دسترسی مدیریت'],['حساب‌ها','…','▦','در حال بارگذاری']]); $('#dynamicContent').innerHTML=panel('حساب‌های کاربران','نام کاربری و نقش هر حساب','<div id="userList" class="empty">در حال دریافت…</div>');
    const unsub=db.collection('users').orderBy('createdAt','desc').limit(300).onSnapshot(s=>{ renderStats([['نقش شما','مدیر','♙','دسترسی مدیریت'],['حساب‌ها',String(s.size),'▦','کاربران ثبت‌شده']]); $('#userList').innerHTML=s.empty?'<p class="empty">هنوز کاربری ساخته نشده است.</p>':`<div class="table-wrap"><table><thead><tr><th>نام</th><th>نام کاربری</th><th>نقش</th></tr></thead><tbody>${s.docs.map(d=>{const u=d.data();return `<tr><td>${safe(u.displayName)}</td><td>${safe(u.username)}</td><td>${safe(roles[u.role]||u.role)}</td></tr>`}).join('')}</tbody></table></div>`; },e=>$('#userList').textContent=friendlyError(e)); unsubscribers.push(unsub);
  }
  function loadMessages() {
    renderStats([['پیام‌رسان','فعال','✉','گفتگوی خصوصی'],['حساب شما',roles[profile.role],'♙','دسترسی بر اساس نقش']]);
    $('#mainAction').textContent='＋ گفتگوی جدید'; $('#mainAction').classList.remove('hidden');
    $('#dynamicContent').innerHTML = `<div class="messenger-grid"><section class="panel"><div class="panel-head"><div><h3>گفتگوهای من</h3><p class="muted">پیام‌های خصوصی با کاربران مدرسه</p></div></div><div id="conversationList" class="conversation-list"><p class="empty">در حال دریافت گفتگوها…</p></div></section><section class="panel message-panel"><div class="panel-head"><div><h3>پیام‌ها</h3><p class="muted">گفتگو را انتخاب کن یا گفتگوی جدید بساز.</p></div></div><div id="messageThread" class="message-thread-empty">✉<p>هنوز گفتگویی انتخاب نشده است.</p></div></section></div>`;
    const list = $('#conversationList');
    $('#dynamicContent').onclick = e => {
      if (e.target.closest('#startConversationInline')) { openStartConversation(); return; }
      const button=e.target.closest('[data-conversation-id]');
      if(button){ const convo=window.__schoolConversations?.[button.dataset.conversationId]; if(convo){ activeConversationId=button.dataset.conversationId; renderMessageThread(activeConversationId,convo); list.querySelectorAll('[data-conversation-id]').forEach(x=>x.classList.toggle('selected',x===button)); } }
    };
    const unsub = db.collection('conversations').where('participants','array-contains',currentUser.uid).onSnapshot(snap=>{
      const docs=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{
        const av=(a.updatedAt?.toMillis?.()||a.createdAt?.toMillis?.()||0), bv=(b.updatedAt?.toMillis?.()||b.createdAt?.toMillis?.()||0); return bv-av;
      });
      window.__schoolConversations = Object.fromEntries(docs.map(c=>[c.id,c]));
      list.innerHTML = docs.length ? docs.map(c=>{
        const otherUid=(c.participants||[]).find(uid=>uid!==currentUser.uid); const name=c.participantNames?.[otherUid]||c.participantUsernames?.[otherUid]||'کاربر مدرسه';
        const preview=c.lastMessage || 'گفتگو شروع شده است';
        return `<button class="conversation-item ${c.id===activeConversationId?'selected':''}" data-conversation-id="${safe(c.id)}"><span class="conversation-avatar">${safe(name.slice(0,1))}</span><span class="conversation-copy"><b>${safe(name)}</b><small>${safe(preview)}</small></span><span class="conversation-arrow">‹</span></button>`;
      }).join('') : '<div class="empty">هنوز گفتگویی نداری.<br><button id="startConversationInline" class="text-btn" type="button">شروع گفتگوی جدید</button></div>';
      if(activeConversationId && window.__schoolConversations[activeConversationId]) renderMessageThread(activeConversationId,window.__schoolConversations[activeConversationId]);
      else if(!activeConversationId && docs.length) { activeConversationId=docs[0].id; renderMessageThread(docs[0].id,docs[0]); }
    },err=>{ list.textContent=friendlyError(err); });
    unsubscribers.push(unsub);
  }
  function renderMessageThread(conversationId, convo) {
    const thread=$('#messageThread'); if(!thread)return;
    if(renderedConversationId===conversationId && $('#sendMessageForm')) return;
    if(messageUnsub){try{messageUnsub();}catch{} messageUnsub=null;}
    const otherUid=(convo.participants||[]).find(uid=>uid!==currentUser.uid);
    const name=convo.participantNames?.[otherUid]||convo.participantUsernames?.[otherUid]||'کاربر مدرسه';
    thread.innerHTML=`<div class="chat-heading"><span class="conversation-avatar">${safe(name.slice(0,1))}</span><div><b>${safe(name)}</b><small>${safe(convo.participantUsernames?.[otherUid]||'گفتگوی خصوصی')}</small></div></div><div id="chatMessages" class="chat-messages"><p class="empty">در حال دریافت پیام‌ها…</p></div><form id="sendMessageForm" class="send-message-form"><textarea id="messageText" maxlength="2000" rows="2" required placeholder="پیامت را بنویس…"></textarea><button class="primary" type="submit">ارسال</button></form><p id="chatFeedback" class="feedback" role="status"></p>`;
    renderedConversationId=conversationId;
    const messagesEl=$('#chatMessages');
    messageUnsub=db.collection('conversations').doc(conversationId).collection('messages').orderBy('createdAt','asc').limit(300).onSnapshot(snap=>{
      messagesEl.innerHTML=snap.empty?'<p class="empty">اولین پیام این گفتگو را بفرست.</p>':snap.docs.map(d=>{const m=d.data(), mine=m.senderUid===currentUser.uid; const time=m.createdAt?new Intl.DateTimeFormat('fa-IR',{hour:'2-digit',minute:'2-digit'}).format(m.createdAt.toDate()):'اکنون'; return `<div class="message-line ${mine?'mine':''}"><div class="message-bubble"><p>${safe(m.text).replace(/\n/g,'<br>')}</p><small>${mine?'شما':'پیام'} · ${safe(time)}</small></div></div>`;}).join('');
      messagesEl.scrollTop=messagesEl.scrollHeight;
    },err=>{messagesEl.textContent=friendlyError(err);});
    $('#sendMessageForm').onsubmit=async e=>{
      e.preventDefault(); const textarea=$('#messageText'), button=e.submitter, textValue=textarea.value.trim(); if(!textValue)return;
      button.disabled=true; textarea.disabled=true; $('#chatFeedback').textContent='در حال ارسال…';
      try{
        const conversationRef=db.collection('conversations').doc(conversationId);
        await conversationRef.collection('messages').add({text:textValue,senderUid:currentUser.uid,senderName:profile.displayName||profile.username,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
        await conversationRef.update({lastMessage:textValue.slice(0,180),lastSenderUid:currentUser.uid,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
        textarea.value=''; $('#chatFeedback').textContent='';
      }catch(err){setMessage($('#chatFeedback'),friendlyError(err),true);}finally{button.disabled=false;textarea.disabled=false;textarea.focus();}
    };
  }
  function openStartConversation() {
    showModal('گفتگوی جدید','نام کاربری فردی از کاربران مدرسه را وارد کن.',`<label>نام کاربری گیرنده<input name="username" required minlength="3" maxlength="30" pattern="[A-Za-z0-9._-]+" autocomplete="off" placeholder="مثلاً ali.ahmadi"></label><button class="primary full" type="submit">شروع گفتگو</button>`,async f=>{
      const result=await functions.httpsCallable('startConversation')({username:f.get('username').trim()});
      activeConversationId=result.data.conversationId;
      loadPage('messages');
    });
  }
  function showModal(title,intro,html,handler) { $('#modalTitle').textContent=title; $('#modalIntro').textContent=intro; $('#modalForm').innerHTML=html; $('#modalFeedback').textContent=''; $('#modal').classList.remove('hidden'); $('#modalForm').onsubmit=async e=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;try{await handler(new FormData(e.currentTarget));$('#modal').classList.add('hidden');}catch(err){setMessage($('#modalFeedback'),friendlyError(err),true);}finally{btn.disabled=false;}}; }
  function openCreateUser() {
    if(profile?.role!=='admin')return;
    showModal('ساخت حساب کاربری','مدیر برای هر معلم یا دانش‌آموز حساب جداگانه می‌سازد.',`<label>نام و نام خانوادگی<input name="displayName" required maxlength="80"></label><label>نام کاربری<input name="username" required minlength="3" maxlength="30" pattern="[A-Za-z0-9._-]+" autocomplete="off"></label><label>رمز عبور اولیه<input name="password" type="password" required minlength="8" autocomplete="new-password"></label><label>نقش<select name="role" required><option value="student">دانش‌آموز</option><option value="teacher">معلم</option></select></label><button class="primary full" type="submit">ساخت حساب</button>`,async f=>{await functions.httpsCallable('createSchoolUser')({displayName:f.get('displayName').trim(),username:f.get('username').trim(),password:f.get('password'),role:f.get('role')});});
  }
  function openCreateContent(type) {
    const isAnnouncement=type==='announcement'; if(isAnnouncement&&profile.role==='student'){setMessage($('#modalFeedback'),'دانش‌آموز اجازه انتشار اطلاعیه ندارد.',true);return;}
    const collection=isAnnouncement?'announcements':'assignments';
    showModal(isAnnouncement?'انتشار اطلاعیه':'ایجاد تکلیف',isAnnouncement?'اطلاعیه برای کاربران مدرسه نمایش داده می‌شود.':'تکلیف جدید را برای دانش‌آموزان ثبت کن.',`<label>عنوان<input name="title" required maxlength="120"></label><label>توضیحات<textarea name="description" maxlength="2000" rows="4"></textarea></label><button class="primary full" type="submit">${isAnnouncement?'انتشار اطلاعیه':'ثبت تکلیف'}</button>`,async f=>{if(profile.role==='student')throw new Error('دانش‌آموز اجازه ثبت مورد جدید ندارد.');await db.collection(collection).add({title:f.get('title').trim(),description:f.get('description').trim(),authorUid:currentUser.uid,authorName:profile.displayName||profile.username,createdAt:firebase.firestore.FieldValue.serverTimestamp()});});
  }
  $('#modalX').addEventListener('click',()=>$('#modal').classList.add('hidden')); $('#modal').addEventListener('click',e=>{if(e.target.id==='modal')$('#modal').classList.add('hidden');});
  if (!initFirebase()) { $('#connectionStatus').textContent='نیازمند تنظیمات'; }
})();
