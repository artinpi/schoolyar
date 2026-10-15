const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const bootstrapSecret = defineSecret('BOOTSTRAP_SECRET');
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,30}$/;
const usernameToEmail = username => `${String(username).trim().toLowerCase()}@madreseyar.app`;
function validateUsername(username) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) throw new HttpsError('invalid-argument', 'نام کاربری باید ۳ تا ۳۰ نویسه و شامل حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد.');
}
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new HttpsError('invalid-argument', 'رمز عبور باید حداقل ۸ نویسه داشته باشد.');
}
function validateName(name) {
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) throw new HttpsError('invalid-argument', 'نام نمایشی معتبر نیست.');
}
async function createAuthAndProfile({name, username, password, role}) {
  validateUsername(username); validatePassword(password); validateName(name);
  const normalized = username.toLowerCase();
  const usernameRef = db.collection('usernames').doc(normalized);
  const reservation = await db.runTransaction(async tx => {
    const snap = await tx.get(usernameRef);
    if (snap.exists) throw new HttpsError('already-exists', 'این نام کاربری قبلاً استفاده شده است.');
    tx.create(usernameRef, { reservedAt: admin.firestore.FieldValue.serverTimestamp() });
    return true;
  });
  let userRecord;
  try {
    userRecord = await admin.auth().createUser({email: usernameToEmail(normalized), password, displayName: name.trim(), disabled: false});
    await admin.auth().setCustomUserClaims(userRecord.uid, {role});
    await db.collection('users').doc(userRecord.uid).set({uid:userRecord.uid, username:normalized, displayName:name.trim(), role, createdAt:admin.firestore.FieldValue.serverTimestamp(), active:true});
    await usernameRef.set({uid:userRecord.uid, username:normalized, createdAt:admin.firestore.FieldValue.serverTimestamp()});
    return userRecord;
  } catch (error) {
    if (userRecord) { try { await admin.auth().deleteUser(userRecord.uid); } catch (_) {} }
    try { await usernameRef.delete(); } catch (_) {}
    if (error instanceof HttpsError) throw error;
    if (error.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'این نام کاربری قبلاً استفاده شده است.');
    throw new HttpsError('internal', 'ساخت حساب ناموفق بود. تنظیمات سرور را بررسی کنید.');
  }
}
exports.bootstrapAdmin = onCall({secrets:[bootstrapSecret], enforceAppCheck:false}, async request => {
  const {name, username, password, secret} = request.data || {};
  if (!secret || secret !== bootstrapSecret.value()) throw new HttpsError('permission-denied', 'کد راه‌اندازی اشتباه است.');
  const lockRef = db.collection('_system').doc('setup');
  const lock = await db.runTransaction(async tx => {
    const snap = await tx.get(lockRef);
    if (snap.exists && snap.data().adminCreated) throw new HttpsError('failed-precondition', 'حساب مدیر قبلاً ساخته شده است.');
    tx.set(lockRef, {adminCreated:true, startedAt:admin.firestore.FieldValue.serverTimestamp(), status:'creating'});
    return true;
  });
  try {
    const user = await createAuthAndProfile({name, username, password, role:'admin'});
    await lockRef.set({adminCreated:true, adminUid:user.uid, createdAt:admin.firestore.FieldValue.serverTimestamp(), status:'complete'});
    return {success:true};
  } catch (error) {
    await lockRef.set({adminCreated:false, status:'failed', updatedAt:admin.firestore.FieldValue.serverTimestamp()});
    throw error;
  }
});
exports.createSchoolUser = onCall({enforceAppCheck:false}, async request => {
  if (!request.auth || request.auth.token.role !== 'admin') throw new HttpsError('permission-denied', 'فقط مدیر مدرسه می‌تواند حساب جدید بسازد.');
  const {displayName, username, password, role} = request.data || {};
  if (!['student','teacher'].includes(role)) throw new HttpsError('invalid-argument', 'نقش کاربر معتبر نیست.');
  const user = await createAuthAndProfile({name:displayName, username, password, role});
  return {success:true, uid:user.uid, username:String(username).toLowerCase()};
});


// Start or retrieve a private conversation by username. User lookup stays server-side.
const crypto = require('crypto');
exports.startConversation = onCall({enforceAppCheck:false}, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ابتدا وارد حساب شو.');
  const username = String(request.data?.username || '').trim().toLowerCase();
  validateUsername(username);
  const targetSnap = await db.collection('usernames').doc(username).get();
  if (!targetSnap.exists || !targetSnap.data()?.uid) throw new HttpsError('not-found', 'کاربری با این نام کاربری پیدا نشد.');
  const targetUid = targetSnap.data().uid;
  const callerUid = request.auth.uid;
  if (targetUid === callerUid) throw new HttpsError('invalid-argument', 'نمی‌توانی با حساب خودت گفتگو بسازی.');
  const uids = [callerUid, targetUid].sort();
  const conversationId = crypto.createHash('sha256').update(uids.join(':')).digest('hex');
  const ref = db.collection('conversations').doc(conversationId);
  const [callerSnap, targetProfileSnap] = await Promise.all([
    db.collection('users').doc(callerUid).get(),
    db.collection('users').doc(targetUid).get()
  ]);
  if (!callerSnap.exists || !targetProfileSnap.exists || targetProfileSnap.data().active === false) {
    throw new HttpsError('not-found', 'حساب فعال پیدا نشد.');
  }
  const caller = callerSnap.data(), target = targetProfileSnap.data();
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.create(ref, {
        participants: uids,
        participantNames: {
          [callerUid]: caller.displayName || caller.username,
          [targetUid]: target.displayName || target.username
        },
        participantUsernames: { [callerUid]: caller.username, [targetUid]: target.username },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastMessage: '', lastSenderUid: ''
      });
    }
  });
  return {success:true, conversationId};
});
