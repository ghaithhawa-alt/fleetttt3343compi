/* i18n-ar-server.js — arabische Fassung der Servermeldungen
 *
 * Die Meldungen kommen als fertiger deutscher Text aus dem Server. Sie hier
 * zu übersetzen erspart es, an 118 Stellen in server.py einzugreifen — und
 * die Protokolle auf dem Server bleiben deutsch, was für die Fehlersuche gut
 * ist.
 */
(function () {
  "use strict";
  if (!window.fcSprache) return;

  var M = {
    /* ── Anmeldung und Passwort ─────────────────────────────────── */
    "Aktuelles Passwort ist falsch": "كلمة المرور الحالية غير صحيحة",
    "E-Mail oder Passwort falsch": "البريد الإلكتروني أو كلمة المرور غير صحيحة",
    "E-Mail oder Einmal-Passwort stimmt nicht": "البريد الإلكتروني أو كلمة المرور المؤقتة غير صحيحة",
    "E-Mail ist bereits registriert": "البريد الإلكتروني مسجَّل بالفعل",
    "E-Mail ist bereits vergeben": "البريد الإلكتروني مستخدَم بالفعل",
    "Diese E-Mail wird schon benutzt": "هذا البريد الإلكتروني مستخدَم بالفعل",
    "Diese E-Mail wird bereits benutzt. Jede Adresse kann nur zu einem Zugang gehören - auch über Firmengrenzen hinweg.":
      "هذا البريد الإلكتروني مستخدَم بالفعل. كل عنوان يخصّ حساباً واحداً فقط — حتى بين الشركات المختلفة.",
    "Das neue Passwort muss mindestens 8 Zeichen haben": "كلمة المرور الجديدة يجب ألا تقل عن ٨ أحرف",
    "Das Passwort muss mindestens 8 Zeichen haben": "كلمة المرور يجب ألا تقل عن ٨ أحرف",
    "Neues Passwort muss mindestens 8 Zeichen haben": "كلمة المرور الجديدة يجب ألا تقل عن ٨ أحرف",
    "Passwort braucht mindestens 8 Zeichen": "كلمة المرور تحتاج ٨ أحرف على الأقل",
    "Nicht angemeldet oder Token ungueltig": "لم يتم تسجيل الدخول أو انتهت صلاحية الجلسة",
    "Bitte eine gueltige E-Mail angeben": "يرجى إدخال بريد إلكتروني صالح",
    "Bitte eine gueltige E-Mail-Adresse angeben": "يرجى إدخال عنوان بريد إلكتروني صالح",

    /* ── Berechtigungen ─────────────────────────────────────────── */
    "Das darf nur der Inhaber des Betriebs.": "هذا مسموح لصاحب الشركة فقط.",
    "Das darf nur der Inhaber des Betriebs umstellen.": "صاحب الشركة وحده يستطيع تغيير هذا.",
    "Endgültig löschen darf nur der Inhaber des Betriebs.": "الحذف النهائي مسموح لصاحب الشركة فقط.",
    "Nur der Inhaber darf das Team verwalten": "إدارة الفريق مسموحة لصاحب الشركة فقط",
    "Für diese Funktion fehlt dir die Berechtigung. Wende dich an den Inhaber deines Betriebs.":
      "ليست لديك صلاحية لهذه الوظيفة. يرجى مراجعة صاحب الشركة.",
    "Für Vorgänge fehlt dir die Berechtigung.": "ليست لديك صلاحية للعمليات.",
    "Kein Zugriff auf andere Betriebe": "لا يوجد وصول إلى شركات أخرى",
    "Kein Zugriff auf die Verwaltung": "لا يوجد وصول إلى لوحة الإدارة",
    "Kein Zugriff auf diesen Mandanten": "لا يوجد وصول إلى هذا العميل",
    "Keine Berechtigung fuer diese Firma": "لا توجد صلاحية لهذه الشركة",
    "Nur fuer Superadmin": "للمشرف العام فقط",
    "Zuordnungen kann nur der Superadmin loesen": "المشرف العام وحده يستطيع فك الارتباطات",
    "Bestehende Firmen darf nur ein Admin zuordnen": "ربط الشركات القائمة مسموح للمشرف فقط",
    "Dein Konto darf keine Mandanten fuehren": "حسابك لا يسمح بإدارة عملاء",
    "Das Superadmin-Konto kann nicht geaendert werden": "لا يمكن تعديل حساب المشرف العام",

    /* ── Team und Zugänge ───────────────────────────────────────── */
    "Das ist der letzte Inhaber-Zugang und kann nicht gesperrt werden.":
      "هذا آخر حساب لصاحب الشركة ولا يمكن حظره.",
    "Das ist der letzte Inhaber-Zugang. Mach zuerst jemand anderen zum Inhaber.":
      "هذا آخر حساب لصاحب الشركة. عيّن شخصاً آخر صاحباً أولاً.",
    "Du kannst dich nicht selbst sperren.": "لا يمكنك حظر نفسك.",
    "Dieser Zugang wurde gesperrt.": "تم حظر هذا الحساب.",
    "Zugang nicht gefunden": "الحساب غير موجود",
    "Team-Zugänge sind in deinem Tarif nicht enthalten.": "حسابات الفريق غير مشمولة في باقتك.",
    "Vorgänge sind in deinem Tarif nicht enthalten.": "العمليات غير مشمولة في باقتك.",
    "Anzahl Zugänge muss zwischen 1 und 500 liegen": "عدد الحسابات يجب أن يكون بين ١ و ٥٠٠",
    "Anzahl muss zwischen 1 und 500 liegen": "العدد يجب أن يكون بين ١ و ٥٠٠",

    /* ── Vorgänge ───────────────────────────────────────────────── */
    "Vorgang nicht gefunden": "العملية غير موجودة",
    "Dieser Vorgang ist bereits offen.": "هذه العملية مفتوحة بالفعل.",
    "Dieser Vorgang ist bereits storniert.": "هذه العملية ملغاة بالفعل.",
    "Dieser Vorgang ist schon erledigt.": "هذه العملية منجزة بالفعل.",
    "Dieser Vorgang ist storniert und kann nicht geändert werden.":
      "هذه العملية ملغاة ولا يمكن تعديلها.",
    "Dieser Vorgang wartet nicht auf eine Bestätigung.": "هذه العملية لا تنتظر تأكيداً.",
    "Nur stornierte Vorgänge lassen sich löschen. Storniere ihn zuerst – so bleibt nachvollziehbar, dass es ihn gab.":
      "لا يمكن حذف سوى العمليات الملغاة. ألغِ العملية أولاً — هكذا يبقى وجودها موثّقاً.",
    "Wer das Geld gemeldet hat, kann es nicht selbst bestätigen. Das muss eine zweite Person tun.":
      "من سجّل المبلغ لا يمكنه تأكيده بنفسه. يجب أن يقوم بذلك شخص ثانٍ.",
    "Bitte den Betrag eintragen, der abkassiert werden soll.": "يرجى إدخال المبلغ المطلوب تحصيله.",
    "Bitte den Fahrer auswählen, bei dem kassiert werden soll.": "يرجى اختيار السائق المطلوب التحصيل منه.",
    "Bei einer Betragsänderung bitte kurz den Grund angeben.":
      "عند تغيير المبلغ يرجى ذكر السبب باختصار.",
    "Bitte einen Grund angeben.": "يرجى ذكر السبب.",
    "Bitte einen Grund für die Stornierung angeben.": "يرجى ذكر سبب الإلغاء.",
    "Bitte kurz angeben, wofür der Abzug ist – sonst weiß später niemand, warum weniger Geld kam.":
      "يرجى بيان سبب الخصم باختصار — وإلا لن يعرف أحد لاحقاً لماذا نقص المبلغ.",
    "Bitte kurz beschreiben, was gefehlt hat.": "يرجى وصف ما كان ناقصاً باختصار.",
    "Der erhaltene Betrag lässt sich erst nach dem Abhaken ändern.":
      "لا يمكن تعديل المبلغ المستلَم إلا بعد وضع العلامة.",
    "Der Hinweis ist leer.": "الملاحظة فارغة.",
    "Der Titel darf nicht leer sein.": "العنوان لا يجوز أن يكون فارغاً.",
    "Ergebnis muss 'komplett' oder 'teilweise' sein": "النتيجة يجب أن تكون «كامل» أو «جزئي»",
    "Löschen nicht möglich. Bitte noch einmal versuchen.": "الحذف غير ممكن. يرجى المحاولة مرة أخرى.",

    /* ── Mitarbeiter und Firma ──────────────────────────────────── */
    "Mitarbeiter nicht gefunden": "الموظف غير موجود",
    "Mitarbeiter existiert bereits": "الموظف موجود بالفعل",
    "Fahrer nicht gefunden": "السائق غير موجود",
    "Firma nicht gefunden": "الشركة غير موجودة",
    "Firmenname darf nicht leer sein": "اسم الشركة لا يجوز أن يكون فارغاً",
    "Firmenname fehlt": "اسم الشركة ناقص",
    "Bitte einen Firmennamen angeben": "يرجى إدخال اسم الشركة",
    "Name ist erforderlich": "الاسم مطلوب",
    "Name bereits vergeben": "الاسم مستخدَم بالفعل",
    "Das ist die eigene Firma": "هذه هي شركتك أنت",
    "Die eigene Admin-Firma kann nicht geloescht werden": "لا يمكن حذف شركة الإدارة الخاصة بك",
    "Eine Firma kann sich nicht selbst zugeordnet werden": "لا يمكن ربط الشركة بنفسها",
    "Diese Firma ist bereits zugeordnet": "هذه الشركة مرتبطة بالفعل",
    "Diese Firma hat nicht die Lizenzart 'Gruppe'": "هذه الشركة ليست من نوع ترخيص «مجموعة»",
    "Bereits zugeordnet": "مرتبط بالفعل",
    "Zuordnung nicht gefunden": "الارتباط غير موجود",
    "Zu dieser Firma gibt es keinen Benutzer": "لا يوجد مستخدم لهذه الشركة",
    "Das Firmenprofil ist gesperrt. Bitte eine Freischaltung beantragen.":
      "ملف الشركة محظور. يرجى طلب إعادة التفعيل.",
    "Anfrage nicht gefunden": "الطلب غير موجود",

    /* ── Daten, Dateien, Formate ────────────────────────────────── */
    "Ungueltiges JSON": "‏JSON غير صالح",
    "Eintrag existierte nicht": "السجل غير موجود",
    "Plan nicht gefunden": "الباقة غير موجودة",
    "Vorlage nicht gefunden": "القالب غير موجود",
    "Standard-Vorlagen koennen nicht geloescht werden.": "لا يمكن حذف القوالب الافتراضية.",
    "Schluessel darf nicht leer sein": "المفتاح لا يجوز أن يكون فارغاً",
    "monat muss YYYY-MM Format haben": "الشهر يجب أن يكون بصيغة YYYY-MM",
    "monat Pflicht": "الشهر إلزامي",
    "monat, data Pflicht": "الشهر والبيانات إلزاميان",
    "periode, data Pflicht": "الفترة والبيانات إلزاميتان",
    "mitarbeiter Pflicht": "الموظف إلزامي",
    "aktion_bis muss YYYY-MM-DD sein": "تاريخ انتهاء العرض يجب أن يكون بصيغة YYYY-MM-DD",
    "gueltig_bis muss YYYY-MM-DD sein": "تاريخ الصلاحية يجب أن يكون بصيغة YYYY-MM-DD",
    "Rabatt muss zwischen 0 und 100 liegen": "الخصم يجب أن يكون بين ٠ و ١٠٠",
    "Breitengrad muss zwischen -90 und 90 liegen": "خط العرض يجب أن يكون بين ‎-90 و 90",
    "Laengengrad muss zwischen -180 und 180 liegen": "خط الطول يجب أن يكون بين ‎-180 و 180",
    "Nur PNG- oder JPEG-Bilder werden unterstuetzt.": "الصور المدعومة هي PNG أو JPEG فقط.",
    "Das Logo ist zu groß (max. ca. 1,5 MB). Bitte ein kleineres Bild verwenden.":
      "الشعار كبير جداً (الحد الأقصى نحو ١٫٥ ميغابايت). يرجى استخدام صورة أصغر.",

    /* ── Cloud-Hinweise ─────────────────────────────────────────── */
    "Cloud-Version: Server laeuft weiter, bitte einfach abmelden.":
      "النسخة السحابية: الخادم يعمل باستمرار، يكفي تسجيل الخروج.",
    "Cloud-Version: Daten-Loeschung erfolgt ueber die Firmen-Verwaltung.":
      "النسخة السحابية: حذف البيانات يتم من إدارة الشركات.",
    "Cloud-Version: Firmen registrieren sich selbst; Verwaltung ueber /admin/firmen.":
      "النسخة السحابية: الشركات تسجّل نفسها؛ الإدارة عبر ‎/admin/firmen."
  };

  /* ── Meldungen mit eingesetzten Werten ──────────────────────────
     Der Server setzt Namen, Beträge und Zahlen in den Text ein. Deshalb
     passt kein wörtlicher Vergleich — hier greifen Muster, die den
     eingesetzten Teil unverändert übernehmen. */
  var MUSTER = [
    [/^Alle (.+?) Plätze sind belegt\.$/,
     "جميع الأماكن مشغولة ($1)."],
    [/^Alle (.+?) Plätze sind belegt\. Sperre einen Zugang oder wechsle in einen größeren Tarif\.$/,
     "جميع الأماكن مشغولة ($1). احظر حساباً أو انتقل إلى باقة أكبر."],
    [/^Es sind bereits (.+?) Zugänge aktiv$/, "يوجد بالفعل $1 حساباً نشطاً"],
    [/^Es sind bereits (.+?) Unternehmen zugeordnet$/, "يوجد بالفعل $1 شركة مرتبطة"],
    [/^Grenze erreicht: (.+?) von (.+?) Unternehmen belegt$/,
     "تم بلوغ الحد: $1 من $2 شركة مشغولة"],
    [/^Aus diesem Vorgang läuft noch ein Restbetrag weiter \(„(.+?)“\)\. Storniere zuerst diesen\.$/,
     "لا يزال مبلغ متبقٍّ سارياً من هذه العملية («$1»). ألغِ ذلك أولاً."],
    [/^Aus diesem Vorgang läuft noch etwas weiter \(„(.+?)“\)\. Kümmere dich zuerst darum\.$/,
     "لا يزال هناك ما يتبع هذه العملية («$1»). عالج ذلك أولاً."],
    [/^Kein gültiger Betrag: (.+)$/, "مبلغ غير صالح: $1"],
    [/^Ungültige Kalenderwoche: (.+)$/, "أسبوع غير صالح: $1"],
    [/^Unbekannte Art: (.+)$/, "نوع غير معروف: $1"],
    [/^Unbekannte Rolle: (.+)$/, "دور غير معروف: $1"],
    [/^Unbekannte Lizenzart: (.+)$/, "نوع ترخيص غير معروف: $1"],
    [/^Unbekannte Module: (.+)$/, "وحدات غير معروفة: $1"],
    [/^Unbekannter Plan: (.+)$/, "باقة غير معروفة: $1"],
    [/^Unbekannte Sprache: (.+)$/, "لغة غير معروفة: $1"],
    [/^Datei nicht gefunden: (.+)$/, "الملف غير موجود: $1"],
    [/^Firma konnte nicht geloescht werden: (.+)$/, "تعذّر حذف الشركة: $1"],
    [/^Löschen nicht möglich: (.+)$/, "الحذف غير ممكن: $1"],
    [/^Plan wird noch von '(.+?)' benutzt$/, "الباقة ما زالت مستخدَمة من «$1»"],
    [/^Schluessel '(.+?)' gibt es schon$/, "المفتاح «$1» موجود بالفعل"],
    [/^Zur Sicherheit bitte den Betriebsnamen genau so eintippen: (.+)$/,
     "للتأكيد يرجى كتابة اسم الشركة تماماً هكذا: $1"]
  ];

  window.fcSprache.woerterbuch("ar", M, MUSTER);
})();
