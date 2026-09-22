/* Admin-Panel Logik: Auth-Check, Navigation, Ansichten.
   Echte Bereiche: Übersicht, Firmen & Benutzer, Lizenzen.
   Kommt bald: Nachrichten, Support, Einnahmen, Preise, Rollen. */
(function(){
  var KEY="fc_token";
  var firmen=[];
  var plaene=[];
  var anfragen=[];
  var vorlagen=[];
  var platzhalter=[];
  var steuerzeichen=[];
  // Fest ausgelieferte Vorlagen - koennen bearbeitet, aber nicht geloescht werden.
  var STANDARD_VORLAGEN=["vollzeit","teilzeit","minijob","kuendigung","aufhebung"];
  var ICH={superadmin:false,rolle:"benutzer",email:""};
  var ALLE_MODULE=[
    {id:"zeitnachweis",label:"Zeitnachweis"},
    {id:"buchhaltung",label:"Buchhaltung"},
    {id:"lohnberechnung",label:"Lohn"},
    {id:"fahrtenbuch",label:"Fahrtenbuch"},
    {id:"teamzugaenge",label:"Team-Zugänge"},
    {id:"vorgaenge",label:"Vorgänge"}
  ];
  var ROLLEN=[
    {id:"benutzer",label:"Benutzer"},
    {id:"admin",label:"Admin"}
  ];
  var LIZENZARTEN=[
    {id:"single",label:"Single (ein Unternehmen)"},
    {id:"gruppe",label:"Gruppe (mehrere Unternehmen)"}
  ];
  function rolleLabel(id){var r=ROLLEN.filter(function(x){return x.id===id;})[0];return r?r.label:(id||"Benutzer");}
  function rolleOpts(sel){return ROLLEN.map(function(r){return '<option value="'+r.id+'"'+(sel===r.id?' selected':'')+'>'+esc(r.label)+'</option>';}).join("");}
  function lizenzLabel(id){var l=LIZENZARTEN.filter(function(x){return x.id===id;})[0];return l?l.label.split(" (")[0]:"Single";}
  function lizenzOpts(sel){return LIZENZARTEN.map(function(l){return '<option value="'+l.id+'"'+(sel===l.id?' selected':'')+'>'+esc(l.label)+'</option>';}).join("");}

  /* Wie viele Personen duerfen in dieser Firma arbeiten - und wie viele tun es schon.
     Das Abzeichen erscheint nur, wenn die Firma ueberhaupt Team-Zugaenge hat. */
  function zugaengeBadge(f){
    var hat=(f.modules||[]).indexOf("teamzugaenge")>=0;
    if(!hat) return '';
    var belegt=f.benutzer_aktiv||1, grenze=f.max_benutzer||1;
    var voll=belegt>=grenze;
    return '<span class="a-badge'+(voll?'':' a-badge-green')+'">Team '+belegt+'/'+grenze+'</span>';
  }

  /* Leeres Feld = "nicht anfassen", damit der Plan seine Standardwerte behaelt. */
  function maxBenutzerFeld(id){
    var e=document.getElementById(id);
    if(!e) return null;
    var v=(e.value||"").trim();
    if(!v) return null;
    var n=parseInt(v,10);
    return (isNaN(n)||n<1)?null:n;
  }

  window.logout=function(){localStorage.removeItem(KEY);location.href="/app/";};

  async function api(path,opts){
    opts=opts||{};opts.headers=opts.headers||{};
    opts.headers["Authorization"]="Bearer "+localStorage.getItem(KEY);
    var res=await fetch(path,opts);
    if(res.status===401){location.href="/app/";throw new Error("nicht angemeldet");}
    var data=await res.json().catch(function(){return {};});
    if(!res.ok)throw new Error(data.detail||("Fehler "+res.status));
    return data;
  }
  function eur(v){return (Number(v)||0).toFixed(2).replace(".",",")+" €";}
  function esc(s){var d=document.createElement("div");d.textContent=s==null?"":String(s);return d.innerHTML;}
  function heute(){return new Date().toISOString().slice(0,10);}

  /* ── Dialoge im App-Design (ersetzen die nativen alert/confirm) ── */
  function aDialog(opts){
    var alt=document.getElementById("aDlgHost"); if(alt)alt.remove();
    var host=document.createElement("div"); host.id="aDlgHost";
    var farbe=opts.kind==="danger"?"var(--rot)":(opts.kind==="warn"?"#f59e0b":"var(--gruen)");
    var okBg =opts.kind==="danger"?"var(--rot)":"var(--gruen)";
    host.innerHTML=
      '<div id="aDlgBack" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9998"></div>'
      +'<div style="position:fixed;z-index:9999;left:50%;top:50%;transform:translate(-50%,-50%);'
      +  'width:min(92vw,420px);background:var(--surface2,#141414);border:1px solid var(--line2,rgba(255,255,255,.12));'
      +  'border-radius:14px;padding:22px 22px 18px;font-family:var(--sans);color:var(--text,#fafafa);'
      +  'box-shadow:0 20px 60px rgba(0,0,0,.5)">'
      +  '<div style="font-size:16px;font-weight:600;margin-bottom:8px;color:'+farbe+'">'+esc(opts.title||"Hinweis")+'</div>'
      +  '<div style="font-size:13.5px;line-height:1.55;color:var(--text2,#a1a1aa);white-space:pre-line">'+esc(opts.sub||"")+'</div>'
      +  '<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px">'
      +    (opts.confirm?'<button id="aDlgCancel" style="padding:8px 16px;border-radius:8px;border:1px solid var(--line2,rgba(255,255,255,.12));background:transparent;color:var(--text,#fafafa);font-size:13px;cursor:pointer">Abbrechen</button>':'')
      +    '<button id="aDlgOk" style="padding:8px 16px;border-radius:8px;border:1px solid '+okBg+';background:'+okBg+';color:#0a0a0a;font-weight:600;font-size:13px;cursor:pointer">'+esc(opts.okText||"OK")+'</button>'
      +  '</div></div>';
    document.body.appendChild(host);
    function zu(){ host.remove(); document.onkeydown=null; }
    document.getElementById("aDlgOk").onclick=function(){ zu(); if(opts.onOk)opts.onOk(); };
    var c=document.getElementById("aDlgCancel"); if(c)c.onclick=zu;
    document.getElementById("aDlgBack").onclick=function(){ zu(); if(!opts.confirm&&opts.onOk)opts.onOk(); };
    document.onkeydown=function(e){ if(e.key==="Escape")zu(); };
    document.getElementById("aDlgOk").focus();
  }
  function aAlert(titel,text,art){ aDialog({title:titel,sub:text,kind:art||"info",okText:"OK"}); }
  function aConfirm(titel,text,art,okText,onOk){ aDialog({title:titel,sub:text,kind:art||"warn",okText:okText||"Bestätigen",confirm:true,onOk:onOk}); }
  function statusVon(f){
    if(f.gesperrt)return {txt:"gesperrt",cls:"a-badge-red"};
    if(f.gueltig_bis&&f.gueltig_bis<heute())return {txt:"abgelaufen",cls:"a-badge-red"};
    return {txt:"aktiv",cls:"a-badge-green"};
  }

  /* ── Ansichten ── */
  var VIEWS={
    uebersicht:function(){
      var aktiv=firmen.filter(function(f){return !f.gesperrt&&(!f.gueltig_bis||f.gueltig_bis>=heute());}).length;
      var alleEmails=firmen.reduce(function(a,f){return a+(f.emails?f.emails.length:0);},0);
      return '<div class="a-title">Admin-Übersicht</div>'
        +'<div class="a-kpis">'
        +kpi("Registrierte Firmen",firmen.length,false)
        +kpi("Aktive Lizenzen",aktiv,true)
        +kpi("Benutzer gesamt",alleEmails,false)
        +'</div>'
        +'<div class="a-card"><div class="a-card-head">Registrierte Firmen</div>'
        +'<table class="a-table"><thead><tr><th>Firma</th><th>E-Mail</th><th>Plan</th><th>Status</th><th>Erstellt</th></tr></thead><tbody>'
        +firmen.map(function(f){
          var st=statusVon(f);
          return '<tr><td class="a-em">'+esc(f.name)+'</td>'
            +'<td>'+esc((f.emails&&f.emails[0])||"–")+'</td>'
            +'<td><span class="a-badge">'+esc(f.plan||"trial")+'</span></td>'
            +'<td><span class="a-badge '+st.cls+'">'+st.txt+'</span></td>'
            +'<td class="a-mono">'+esc(f.created_at||"–")+'</td></tr>';
        }).join("")
        +'</tbody></table></div>';
    },

    firmen:function(){
      return '<div class="a-title">Firmen &amp; Benutzer</div>'
        +'<div class="a-card"><div class="a-card-head">Alle Firmen ('+firmen.length+')</div>'
        +'<table class="a-table"><thead><tr><th>Firma</th><th>E-Mail</th><th>Rolle</th><th>Lizenzart</th><th>Gültig bis</th><th>Status</th><th></th></tr></thead><tbody>'
        +firmen.map(function(f){
          var st=statusVon(f);
          var geschuetzt = f.ist_superadmin && !ICH.superadmin;
          return '<tr><td class="a-em">'+esc(f.name)+(f.ist_superadmin?' <span class="a-badge a-badge-green">Superadmin</span>':'')+'</td>'
            +'<td>'+esc((f.emails&&f.emails[0])||"–")+'</td>'
            +'<td><span class="a-badge">'+esc(rolleLabel(f.rolle))+'</span></td>'
            +'<td>'+(f.lizenzart==="gruppe"
                ? '<span class="a-badge a-badge-green">Gruppe '+(f.zugeordnet||0)+'/'+(f.max_firmen||1)+'</span>'
                : '<span class="a-badge">Single</span>')
              +' '+zugaengeBadge(f)+'</td>'
            +'<td class="a-mono">'+esc(f.gueltig_bis||"–")+'</td>'
            +'<td><span class="a-badge '+st.cls+'">'+st.txt+'</span></td>'
            +'<td style="text-align:right;white-space:nowrap">'
            +(geschuetzt
              ? '<span style="font-size:11.5px;color:var(--text4)">geschützt</span>'
              : '<button class="a-btn a-btn-green" data-aktion="oeffneDetail" data-args="['+f.id+']">Bearbeiten</button> '
                +'<button class="a-btn" data-aktion="sperren" data-args="['+f.id+','+(f.gesperrt?"false":"true")+']">'+(f.gesperrt?"Entsperren":"Sperren")+'</button> '
                +'<button class="a-btn a-btn-red" data-aktion="loeschen" data-args="['+f.id+']">Löschen</button>')
            +'</td></tr>';
        }).join("")
        +'</tbody></table></div>';
    },

    lizenzen:function(){
      return '<div class="a-title">Lizenzen</div>'
        +'<div class="a-card" style="margin-bottom:18px"><div class="a-card-head">Neue Firma / Lizenz anlegen</div>'
        +'<div class="a-form-grid">'
        +field("Firmenname","aNewName","text","z.B. MGZ Cars")
        +field("E-Mail (Login)","aNewEmail","email","chef@firma.de")
        +'<div class="a-field"><label>Passwort</label><div style="display:flex;gap:8px">'
        +'<input type="text" id="aNewPw" placeholder="min. 8 Zeichen"><button class="a-btn" data-aktion="pwErzeugen">Erzeugen</button></div></div>'
        +field("Gültig bis","aNewGueltig","date","")
        +'<div class="a-field"><label>Rolle</label><select id="aNewRolle">'+rolleOpts("benutzer")+'</select></div>'
        +'<div class="a-field"><label>Lizenzart</label><select id="aNewLizenz">'+lizenzOpts("single")+'</select></div>'
        +'<div class="a-field"><label>Plan</label><select id="aNewPlan">'+planOpts("")+'</select></div>'
        +'<div class="a-field"><label>Anzahl Zugänge</label>'
        +'<input type="number" min="1" max="500" id="aNewMaxBenutzer" placeholder="leer = laut Plan"></div>'
        +'</div>'
        +'<div style="padding:0 20px 8px"><label style="font-size:11.5px;color:var(--text2);display:block;margin-bottom:8px">Module</label>'
        +'<div class="a-mods" id="aNewMods">'+ALLE_MODULE.map(function(m){return '<button class="a-mod-chip on" data-mod="'+m.id+'" data-chip="1">'+esc(m.label)+'</button>';}).join("")+'</div></div>'
        +'<div class="a-msg" id="aNewMsg"></div>'
        +'<div style="padding:0 20px 18px"><button class="a-btn a-btn-green" data-aktion="firmaAnlegen">Firma anlegen</button></div>'
        +'</div>'
        +'<div class="a-card"><div class="a-card-head">Lizenz-Übersicht</div>'
        +'<table class="a-table"><thead><tr><th>Firma</th><th>Plan</th><th>Gültig bis</th><th>Letzte Aktivität</th><th>Status</th></tr></thead><tbody>'
        +firmen.map(function(f){
          var st=statusVon(f);
          return '<tr><td class="a-em">'+esc(f.name)+'</td>'
            +'<td><span class="a-badge">'+esc(planName(f.plan))+'</span></td>'
            +'<td class="a-mono">'+esc(f.gueltig_bis||"–")+'</td>'
            +'<td class="a-mono">'+esc(f.letzte_aktivitaet||"–")+'</td>'
            +'<td><span class="a-badge '+st.cls+'">'+st.txt+'</span></td></tr>';
        }).join("")
        +'</tbody></table></div>';
    },

    vorlagen:function(){
      if(!ICH.superadmin){
        return '<div class="a-title">Vorlagen</div>'
          +'<div class="a-soon"><h3>Nur für den Superadmin</h3>'
          +'<p>Dokumentvorlagen pflegt der Superadmin.</p></div>';
      }
      return '<div class="a-title">Dokumentvorlagen</div>'
        +'<div class="a-card"><div class="a-card-head" style="display:flex;justify-content:space-between;align-items:center">'
        +  '<span>Vorlagen</span>'
        +  '<button class="a-btn a-btn-green" data-aktion="vorlageNeu">+ Neue Vorlage</button></div>'
        +'<table class="a-table"><thead><tr><th>Vorlage</th><th>Schlüssel</th><th>Umfang</th><th>Zuletzt geändert</th><th></th></tr></thead><tbody>'
        +vorlagen.map(function(v){
          var standard=STANDARD_VORLAGEN.indexOf(v.key)!==-1;
          return '<tr><td class="a-em">'+esc(v.titel)
            +(v.aktiv?'':' <span style="color:var(--rot);font-size:11px;font-weight:600">· inaktiv</span>')+'</td>'
            +'<td class="a-mono" style="font-size:11.5px">'+esc(v.key)+'</td>'
            +'<td class="a-mono">'+(v.text?v.text.length:0)+' Zeichen</td>'
            +'<td class="a-mono" style="font-size:11.5px">'+esc(v.geaendert_am)
              +(v.geaendert_von?'<br><span style="color:var(--text4)">'+esc(v.geaendert_von)+'</span>':'')+'</td>'
            +'<td style="text-align:right"><button class="a-btn a-btn-green" data-aktion="vorlageOeffnen" data-args="[&quot;'+v.key+'&quot;]">Bearbeiten</button>'
            +(standard?'':' <button class="a-btn a-btn-red" data-aktion="vorlageLoeschen" data-args="[&quot;'+v.key+'&quot;]">Löschen</button>')
            +'</td></tr>';
        }).join("")
        +'</tbody></table></div>'
        +'<div class="a-card" style="margin-top:16px"><div class="a-card-head">Verfügbare Platzhalter</div>'
        +'<table class="a-table"><tbody>'
        +platzhalter.map(function(p){
          return '<tr><td class="a-mono" style="color:var(--gruen);width:220px">{{'+esc(p.name)+'}}</td>'
            +'<td>'+esc(p.beschreibung)+'</td></tr>';
        }).join("")
        +'</tbody></table></div>';
    },

    rollen:function(){
      if(!ICH.superadmin){
        return '<div class="a-title">Rollen</div>'
          +'<div class="a-soon"><h3>Nur für den Superadmin</h3>'
          +'<p>Die Vergabe von Rollen ist dem Superadmin vorbehalten.</p></div>';
      }
      return '<div class="a-title">Rollen</div>'
        +'<div class="a-card"><div class="a-card-head">Rollen vergeben</div>'
        +'<table class="a-table"><thead><tr><th>Firma</th><th>E-Mail</th><th>Lizenzart</th><th>Aktuelle Rolle</th><th>Ändern auf</th><th></th></tr></thead><tbody>'
        +firmen.map(function(f){
          if(f.ist_superadmin){
            return '<tr><td class="a-em">'+esc(f.name)+' <span class="a-badge a-badge-green">Superadmin</span></td>'
              +'<td>'+esc((f.emails&&f.emails[0])||"–")+'</td>'
              +'<td><span class="a-badge">'+esc(lizenzLabel(f.lizenzart))+'</span></td>'
              +'<td><span class="a-badge a-badge-green">Superadmin</span></td>'
              +'<td colspan="2" style="color:var(--text4);font-size:12px">wird über die Server-Einstellung festgelegt</td></tr>';
          }
          return '<tr><td class="a-em">'+esc(f.name)+'</td>'
            +'<td>'+esc((f.emails&&f.emails[0])||"–")+'</td>'
            +'<td>'+(f.lizenzart==="gruppe"
                ? '<span class="a-badge a-badge-green">Gruppe '+(f.zugeordnet||0)+'/'+(f.max_firmen||1)+'</span>'
                : '<span class="a-badge">Single</span>')+'</td>'
            +'<td><span class="a-badge">'+esc(rolleLabel(f.rolle))+'</span></td>'
            +'<td><select id="aRolle'+f.id+'" style="height:34px;background:#0d0d0d;border:1px solid var(--line2);border-radius:8px;color:var(--text);padding:0 9px;font-size:12.5px;font-family:var(--sans)">'
            +rolleOpts(f.rolle||"benutzer")+'</select></td>'
            +'<td style="text-align:right"><button class="a-btn a-btn-green" data-aktion="rolleSpeichern" data-args="['+f.id+']">Speichern</button></td></tr>';
        }).join("")
        +'</tbody></table></div>'
        +'<div class="a-card" style="margin-top:16px"><div class="a-card-head">Was die Rollen dürfen</div>'
        +'<table class="a-table"><tbody>'
        +'<tr><td class="a-em">Superadmin</td><td>Alle Rechte. Wird über die Einstellung SUPERADMIN_EMAIL auf dem Server festgelegt.</td></tr>'
        +'<tr><td class="a-em">Admin</td><td>Darf die gesamte Verwaltung nutzen – nur das Superadmin-Konto ist geschützt.</td></tr>'
        +'<tr><td class="a-em">Benutzer</td><td>Normaler Zugang zur App. Kein Zugriff auf die Verwaltung.</td></tr>'
        +'</tbody></table></div>'
        +'<div class="a-card" style="margin-top:16px"><div class="a-card-head">Lizenzarten</div>'
        +'<table class="a-table"><tbody>'
        +'<tr><td class="a-em">Single</td><td>Ein einzelnes Unternehmen.</td></tr>'
        +'<tr><td class="a-em">Gruppe</td><td>Mehrere Unternehmen unter einem Zugang. Die erlaubte Anzahl und die Zuordnung legst du unter "Firmen &amp; Benutzer" im Bearbeiten-Fenster fest.</td></tr>'
        +'</tbody></table></div>';
    },

    nachrichten:soon("Nachrichten","Hier kannst du bald Nachrichten an deine Kunden senden und Rückmeldungen sehen."),
    support:function(){
      var offen=anfragen.filter(function(a){return a.status==="offen";});
      return '<div class="a-title">Support</div>'
        +'<div class="a-card"><div class="a-card-head">Anfragen'
        +(offen.length?' <span class="a-badge a-badge-red">'+offen.length+' offen</span>':'')+'</div>'
        +'<table class="a-table"><thead><tr><th>Firma</th><th>E-Mail</th><th>Anliegen</th><th>Eingegangen</th><th>Status</th><th></th></tr></thead><tbody>'
        +(anfragen.length?anfragen.map(function(a){
          var off=a.status==="offen";
          var istProfil = (a.typ === "profil");
          return '<tr><td class="a-em">'+esc(a.firma_name||"–")+'</td>'
            +'<td>'+esc(a.email)+'</td>'
            +'<td><span class="a-badge">'+(istProfil?"Firmenprofil":"Passwort")+'</span></td>'
            +'<td class="a-mono" style="font-size:11.5px">'+esc(a.erstellt_am)+'</td>'
            +'<td><span class="a-badge '+(off?"a-badge-red":"a-badge-green")+'">'+(off?"offen":"erledigt")+'</span></td>'
            +'<td style="text-align:right;white-space:nowrap">'
            +(off && a.firma_id
              ? (istProfil
                  ? '<button class="a-btn a-btn-green" data-aktion="profilFreigeben" data-args="['+a.firma_id+']">Profil freigeben</button> '
                  : '<button class="a-btn a-btn-green" data-aktion="passwortAusAnfrage" data-args="['+a.firma_id+','+a.id+']">Einmal-Passwort erzeugen</button> ')
                +'<button class="a-btn" data-aktion="anfrageErledigt" data-args="['+a.id+']">Erledigt</button>'
              : '<span style="font-size:11.5px;color:var(--text4)">'+(a.erledigt_am||"")+'</span>')
            +'</td></tr>';
        }).join(""):'<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:28px">Keine Anfragen.</td></tr>')
        +'</tbody></table></div>'
        +'<div id="aAnfragePw" style="margin-top:14px"></div>';
    },
    einnahmen:soon("Einnahmen","Der Umsatz-Überblick über alle Abos wird hier angezeigt, sobald die Bezahlung angebunden ist."),
    preise:function(){
      return '<div class="a-title">Preise &amp; Abos</div>'
        +'<div class="a-card"><div class="a-card-head"><span>Pläne ('+plaene.length+')</span>'
        +'<button class="a-btn a-btn-green" data-aktion="oeffnePlan" data-args="[null]">+ Neuer Plan</button></div>'
        +'<table class="a-table"><thead><tr><th>Plan</th><th>Schlüssel</th><th>Preis / Monat</th><th>Aktion</th><th>Sichtbar</th><th></th></tr></thead><tbody>'
        +(plaene.length?plaene.map(function(p){
          var preis=p.aktion_aktiv
            ? '<span style="text-decoration:line-through;color:var(--text4)">'+eur(p.preis_monat)+'</span> <b style="color:var(--gruen)">'+eur(p.preis_aktuell)+'</b>'
            : eur(p.preis_monat);
          var aktion=p.aktion_aktiv
            ? '<span class="a-badge a-badge-green">'+esc(p.aktion_text||"Aktion")+' −'+p.aktion_prozent+'%</span>'
            : (p.aktion_prozent?'<span class="a-badge">abgelaufen</span>':'<span style="color:var(--text4)">–</span>');
          return '<tr><td class="a-em">'+esc(p.name)+(p.empfohlen?' <span class="a-badge a-badge-green">empfohlen</span>':'')+'</td>'
            +'<td class="a-mono" style="font-size:11.5px">'+esc(p.key)+'</td>'
            +'<td class="a-mono">'+preis+'</td>'
            +'<td>'+aktion+'</td>'
            +'<td>'+(p.aktiv?'<span class="a-badge a-badge-green">ja</span>':'<span class="a-badge">nein</span>')+'</td>'
            +'<td style="text-align:right;white-space:nowrap">'
            +'<button class="a-btn a-btn-green" data-aktion="oeffnePlan" data-args="['+p.id+']">Bearbeiten</button> '
            +'<button class="a-btn a-btn-red" data-aktion="loeschePlan" data-args="['+p.id+']">Löschen</button></td></tr>';
        }).join(""):'<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:28px">Noch keine Pläne.</td></tr>')
        +'</tbody></table></div>';
    }
  };

  function kpi(label,val,green){
    return '<div class="a-kpi"><div class="a-kpi-label">'+esc(label)+'</div>'
      +'<div class="a-kpi-value'+(green?' a-kpi-green':'')+'">'+val+'</div></div>';
  }
  function field(label,id,type,ph){
    return '<div class="a-field"><label>'+esc(label)+'</label><input type="'+type+'" id="'+id+'" placeholder="'+esc(ph)+'"></div>';
  }
  function soon(titel,text){
    return function(){return '<div class="a-title">'+esc(titel)+'</div>'
      +'<div class="a-soon"><h3>'+esc(titel)+' – kommt bald</h3><p>'+esc(text)+'</p></div>';};
  }

  function planName(key){
    var p=plaene.filter(function(x){return x.key===key;})[0];
    return p?p.name:(key||"trial");
  }
  function planOpts(sel){
    var liste=plaene.length?plaene:[{key:"trial",name:"Testphase"}];
    return liste.map(function(p){
      return '<option value="'+esc(p.key)+'"'+(sel===p.key?' selected':'')+'>'+esc(p.name)+'</option>';
    }).join("");
  }

  window.rolleSpeichern=async function(id){
    var sel=document.getElementById("aRolle"+id);
    if(!sel)return;
    try{
      await api("/admin/firmen/update",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({firma_id:id,rolle:sel.value})});
      await ladeFirmen(); render();
    }catch(e){ aAlert("Fehler", e.message, "danger"); }
  };

  /* ── Aktionen (echte Firmen-Verwaltung) ── */
  window.pwErzeugen=function(){
    var z="ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    var p="";for(var i=0;i<12;i++)p+=z[Math.floor(Math.random()*z.length)];
    document.getElementById("aNewPw").value=p;
  };
  window.toggleNewMod=function(el){el.classList.toggle("on");};
  window.firmaAnlegen=async function(){
    var msg=document.getElementById("aNewMsg");msg.className="a-msg";
    var name=document.getElementById("aNewName").value.trim();
    var email=document.getElementById("aNewEmail").value.trim();
    var pw=document.getElementById("aNewPw").value;
    var gueltig=document.getElementById("aNewGueltig").value;
    var mods=[].slice.call(document.querySelectorAll("#aNewMods .a-mod-chip.on")).map(function(c){return c.dataset.mod;});
    var rolle=document.getElementById("aNewRolle")?document.getElementById("aNewRolle").value:"benutzer";
    var plan=document.getElementById("aNewPlan")?document.getElementById("aNewPlan").value:null;
    var lizenz=document.getElementById("aNewLizenz")?document.getElementById("aNewLizenz").value:"single";
    if(!name||!email||!pw){msg.className="a-msg err";msg.textContent="Bitte Name, E-Mail und Passwort ausfüllen.";return;}
    try{
      await api("/admin/firmen/anlegen",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({firma_name:name,email:email,password:pw,modules:mods,
          gueltig_bis:gueltig||null,rolle:rolle,plan:plan||"trial",
          lizenzart:lizenz,max_firmen:(lizenz==="gruppe"?5:1),
          max_benutzer:maxBenutzerFeld("aNewMaxBenutzer")})});
      msg.className="a-msg ok";msg.textContent="Firma angelegt.";
      await ladeFirmen();render();
    }catch(e){msg.className="a-msg err";msg.textContent=e.message;}
  };
  window.sperren=async function(id,sperr){
    try{await api("/admin/firmen/update",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({firma_id:id,gesperrt:sperr})});
      await ladeFirmen();render();}catch(e){aAlert("Fehler",e.message,"danger");}
  };
  window.loeschen=async function(id){
    var f=firmen.filter(function(x){return x.id===id;})[0];
    aConfirm("Firma löschen", "„"+(f?f.name:id)+"\" wirklich löschen? Das kann nicht rückgängig gemacht werden.", "danger", "Löschen", async function(){
    try{await api("/admin/firmen/delete",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({firma_id:id})});
      await ladeFirmen();render();}catch(e){aAlert("Fehler",e.message,"danger");}
    });
  };

  /* Klicks in den Tabellen zentral behandeln - zuverlaessiger als Aufrufe
     direkt im HTML (die z.B. bei strengen Browser-Einstellungen blockiert werden). */
  function klicksAnmelden(el) {
    if (!el || el.dataset.klicksAktiv) return;
    el.dataset.klicksAktiv = "1";
    el.addEventListener("click", function (e) {
      // Modul-Chips einfach umschalten
      var chip = e.target.closest ? e.target.closest("[data-chip]") : null;
      if (chip) { chip.classList.toggle("on"); return; }
      var ziel = e.target.closest ? e.target.closest("[data-aktion]") : null;
      if (!ziel) return;
      var fn = window[ziel.dataset.aktion];
      if (typeof fn !== "function") return;
      e.preventDefault();
      var args = [];
      if (ziel.dataset.args) {
        try { args = JSON.parse(ziel.dataset.args); } catch (x) { args = []; }
      }
      fn.apply(null, args);
    });
  }

  /* ── Navigation ── */
  var current="uebersicht";
  function render(){
    var fn=VIEWS[current]||VIEWS.uebersicht;
    var box=document.getElementById("aViews");
    box.innerHTML=fn();
    klicksAnmelden(box);
  }
  function setupNav(){
    document.querySelectorAll(".a-nav[data-view]").forEach(function(btn){
      btn.onclick=function(){
        current=btn.dataset.view;
        document.querySelectorAll(".a-nav").forEach(function(b){b.classList.remove("active");});
        btn.classList.add("active");
        render();
      };
    });
  }

  async function ladeFirmen(){
    var d=await api("/admin/firmen");firmen=d.firmen||[];
  }

  /* ── Bearbeiten-Fenster (Detail einer Firma) ── */
  window.oeffneDetail=function(id){
    var f=firmen.filter(function(x){return x.id===id;})[0];
    if(!f)return;
    var PLAENE=["trial","starter","business","flotte"];
    var host=document.getElementById("aDetailHost");
    if(!host){host=document.createElement("div");host.id="aDetailHost";document.body.appendChild(host);}
    var modChips=ALLE_MODULE.map(function(m){
      var on=(f.modules||[]).indexOf(m.id)>=0;
      return '<button class="a-mod-chip'+(on?' on':'')+'" data-mod="'+m.id+'" data-chip="1">'+esc(m.label)+'</button>';
    }).join("");
    var planOpts=PLAENE.map(function(p){return '<option value="'+p+'"'+(f.plan===p?' selected':'')+'>'+p+'</option>';}).join("");
    host.innerHTML=
      '<div class="a-modal-backdrop" data-aktion="schliesseDetail"></div>'
      +'<div class="a-modal">'
      +  '<div class="a-modal-head"><div><div class="a-modal-title">'+esc(f.name)+'</div>'
      +    '<div class="a-modal-sub">'+esc((f.emails&&f.emails[0])||"–")+' · erstellt '+esc(f.created_at||"–")+'</div></div>'
      +    '<button class="a-btn" data-aktion="schliesseDetail">Schließen</button></div>'
      // Firmendaten
      +  '<div class="a-modal-sec">Firmendaten</div>'
      +  '<div class="a-modal-grid">'
      +    '<div class="a-field"><label>Firmenname</label><input type="text" id="aDName" value="'+esc(f.name)+'"></div>'
      +    '<div class="a-field"><label>E-Mail (Login)</label><input type="email" id="aDEmail" value="'+esc((f.emails&&f.emails[0])||"")+'"></div>'
      +    '<div class="a-field" style="grid-column:1/-1"><label>Adresse</label><input type="text" id="aDAdresse" value="'+esc(f.adresse||"")+'"></div>'
      +  '</div>'
      // Abo / Lizenz
      +  '<div class="a-modal-sec">Abo &amp; Lizenz</div>'
      +  '<div class="a-modal-grid">'
      +    '<div class="a-field"><label>Plan</label><select id="aDPlan">'+planOpts+'</select></div>'
      +    '<div class="a-field"><label>Gültig bis</label><input type="date" id="aDGueltig" value="'+esc(f.gueltig_bis||"")+'"></div>'
      +    '<div class="a-field"><label>Rolle</label><select id="aDRolle">'+rolleOpts(f.rolle||"benutzer")+'</select></div>'
      +    '<div class="a-field"><label>Lizenzart</label><select id="aDLizenz" onchange="lizenzWechsel()">'+lizenzOpts(f.lizenzart||"single")+'</select></div>'
      +    '<div class="a-field" id="aDMaxWrap"><label>Anzahl Unternehmen</label>'
      +      '<input type="number" min="1" max="500" id="aDMax" value="'+(f.max_firmen||1)+'"></div>'
      +    '<div class="a-field"><label>Anzahl Zugänge</label>'
      +      '<input type="number" min="1" max="500" id="aDMaxBenutzer" value="'+(f.max_benutzer||1)+'">'
      +      '<span class="a-hinweis">Personen in dieser Firma. '
      +        'Für „Team-Zugänge“ muss die Funktion unten aktiv sein.</span></div>'
      +  '</div>'
      +  '<div id="aDGruppe"></div>'
      +  '<p style="font-size:11.5px;color:var(--text3);margin:8px 0 0" id="aDGruppeHinweis"></p>'
      // Funktionen
      +  '<div class="a-modal-sec">Funktionen freischalten</div>'
      +  '<div class="a-mods" id="aDMods" style="padding:0 0 4px">'+modChips+'</div>'
      // Notiz
      +  '<div class="a-modal-sec">Zugang</div>'
      +  '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">'
      +    '<button class="a-btn" data-aktion="passwortNeu" data-args="['+f.id+']">Einmal-Passwort erzeugen</button>'
      +    '<span style="font-size:11.5px;color:var(--text3)">Falls der Kunde sein Passwort vergessen hat.</span>'
      +  '</div>'
      +  '<div id="aPwNeu" style="margin-top:10px"></div>'
      +  '<div class="a-modal-sec">Interne Notiz</div>'
      +  '<textarea id="aDNotes" class="a-textarea" placeholder="Nur für dich sichtbar...">'+esc(f.notes||"")+'</textarea>'
      // Aktionen
      +  '<div class="a-msg" id="aDMsg"></div>'
      +  '<div class="a-modal-actions">'
      +    '<button class="a-btn a-btn-red" data-aktion="loeschenAusDetail" data-args="['+f.id+']">Firma löschen</button>'
      +    '<div style="flex:1"></div>'
      +    '<button class="a-btn" data-aktion="sperrenAusDetail" data-args="['+f.id+','+(f.gesperrt?"false":"true")+']">'+(f.gesperrt?"Entsperren":"Sperren")+'</button>'
      +    '<button class="a-btn a-btn-green" data-aktion="speichereDetail" data-args="['+f.id+']">Speichern</button>'
      +  '</div>'
      +'</div>';
    host.style.display="block";
    klicksAnmelden(host);
    lizenzWechsel();
    if((f.lizenzart||"single")==="gruppe") gruppeLaden(f.id);
  };
  window.lizenzWechsel=function(){
    var art=document.getElementById("aDLizenz").value;
    var wrap=document.getElementById("aDMaxWrap");
    var max=document.getElementById("aDMax");
    if(wrap) wrap.style.display = (art==="gruppe") ? "" : "none";
    if(art==="single" && max) max.value="1";
    var box=document.getElementById("aDGruppe");
    if(box) box.style.display = (art==="gruppe") ? "" : "none";
  };

  /* Die Zuordnung selbst passiert in der App unter Verwaltung > Firmen.
     Hier zeigen wir nur an, wie viele Unternehmen belegt sind. */
  window.gruppeLaden=async function(firmaId){
    var box=document.getElementById("aDGruppe");
    var hinweis=document.getElementById("aDGruppeHinweis");
    if(!box) return;
    try{
      var d=await api("/admin/gruppe/"+firmaId);
      if(d.lizenzart!=="gruppe"){ box.innerHTML=""; box.style.display="none"; if(hinweis)hinweis.textContent=""; return; }
      box.style.display="";
      box.innerHTML=
        '<div class="a-modal-sec">Zugeordnete Unternehmen ('+d.zugeordnet.length+' von '+d.max_firmen+')</div>'
        +(d.zugeordnet.length
          ? '<table class="a-table"><tbody>'
            +d.zugeordnet.map(function(z){return '<tr><td class="a-em">'+esc(z.name)+'</td></tr>';}).join("")
            +'</tbody></table>'
          : '<p style="font-size:12px;color:var(--text3);margin:0">Noch keine Unternehmen zugeordnet.</p>');
      if(hinweis) hinweis.textContent='Zuordnen und Lösen erfolgt in der App unter Verwaltung > Firmen.';
    }catch(e){ box.innerHTML='<div style="color:var(--rot);font-size:12px">'+esc(e.message)+'</div>'; }
  };

  window.vorlageOeffnen=function(key){
    var v=vorlagen.filter(function(x){return x.key===key;})[0];
    if(!v)return;
    var host=document.getElementById("aDetailHost");
    if(!host){host=document.createElement("div");host.id="aDetailHost";document.body.appendChild(host);}
    host.innerHTML=
      '<div class="a-modal-backdrop" data-aktion="schliesseDetail"></div>'
      +'<div class="a-modal" style="max-width:900px">'
      +  '<div class="a-modal-head"><div><div class="a-modal-title">'+esc(v.titel)+'</div>'
      +    '<div class="a-modal-sub">Schlüssel: '+esc(v.key)+' · zuletzt geändert '+esc(v.geaendert_am)+'</div></div>'
      +    '<button class="a-btn" data-aktion="schliesseDetail">Schließen</button></div>'
      +  '<div class="a-modal-sec">Titel</div>'
      +  '<div class="a-field"><input type="text" id="aVTitel" value="'+esc(v.titel)+'"></div>'
      +  '<label style="display:flex;align-items:center;gap:8px;margin:10px 2px;font-size:13px;cursor:pointer">'
      +    '<input type="checkbox" id="aVAktiv"'+(v.aktiv?' checked':'')+'>'
      +    '<span>In der App verfügbar (aktiv)</span>'
      +    '<span style="color:var(--text3);font-size:11.5px">– abgeschaltete Vorlagen kann der Kunde nicht erzeugen</span></label>'
      +  '<div class="a-modal-sec">Text der Vorlage</div>'
      +  '<p style="font-size:11.5px;color:var(--text3);margin:0 0 8px">'
      +    'Platzhalter in doppelten geschweiften Klammern werden beim Erzeugen ersetzt, '
      +    'z.B. <span class="a-mono" style="color:var(--gruen)">{{ma_name}}</span>. '
      +    'Leerzeile = zweimal Enter. Klick unten auf einen Platzhalter, '
      +    'um ihn an der Schreibmarke einzufügen.</p>'
      +  '<div class="a-ph-leiste">'
      +    '<span class="a-ph-titel">Einfügen:</span>'
      +    platzhalter.map(function(p){
             return '<button class="a-ph" data-aktion="einfuegen" data-args="[&quot;{{'+p.name+'}}&quot;]" '
               +'title="'+esc(p.beschreibung)+'">'+p.name+'</button>';
           }).join("")
      +    steuerzeichen.map(function(p){
             return '<button class="a-ph a-ph-blau" data-aktion="einfuegen" data-args="[&quot;'+p.name+'&quot;]" '
               +'title="'+esc(p.beschreibung)+'">'+esc(p.name)+'</button>';
           }).join("")
      +  '</div>'
      +  '<textarea id="aVText" class="a-textarea" style="min-height:420px;font-family:var(--mono);'
      +    'font-size:12px;line-height:1.6">'+esc(v.text||"")+'</textarea>'
      +  '<div class="a-msg" id="aVMsg"></div>'
      +  '<div class="a-modal-actions">'
      +    '<div style="flex:1"></div>'
      +    '<button class="a-btn a-btn-green" data-aktion="vorlageSpeichern" data-args="[&quot;'+v.key+'&quot;]">Speichern</button>'
      +  '</div>'
      +'</div>';
    host.style.display="block";
    klicksAnmelden(host);
  };

  /* Fügt Platzhalter oder Steuerzeichen an der Schreibmarke ein */
  window.einfuegen=function(text){
    var f=document.getElementById("aVText");
    if(!f) return;
    var a=f.selectionStart||0, b=f.selectionEnd||0;
    var zusatz=text;
    // Seitenumbruch braucht eigene Zeilen
    if(text.indexOf("[[")===0) zusatz="\n\n"+text+"\n\n";
    f.value=f.value.slice(0,a)+zusatz+f.value.slice(b);
    var neu=a+zusatz.length;
    f.focus();
    f.setSelectionRange(neu,neu);
  };

  window.vorlageSpeichern=async function(key){
    var msg=document.getElementById("aVMsg");
    msg.className="a-msg"; msg.textContent="Wird gespeichert…";
    try{
      var res=await api("/admin/vorlagen/speichern",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({key:key,titel:document.getElementById("aVTitel").value,
                             text:document.getElementById("aVText").value,
                             aktiv:document.getElementById("aVAktiv").checked})});
      await ladeVorlagen(); render();
      if(res && res.unbekannte_platzhalter && res.unbekannte_platzhalter.length){
        // Gespeichert, aber es gibt Platzhalter, die das Programm nicht kennt.
        msg.className="a-msg err";
        msg.textContent="Gespeichert. Achtung: diese Platzhalter sind unbekannt und bleiben im fertigen Dokument sichtbar stehen: "
          +res.unbekannte_platzhalter.map(function(n){return "{{"+n+"}}";}).join(", ")
          +". Bitte Schreibweise prüfen oder aus der Liste unten einsetzen.";
        return;   // Fenster offen lassen, damit der Hinweis lesbar bleibt
      }
      msg.className="a-msg ok"; msg.textContent="Gespeichert.";
      setTimeout(schliesseDetail,700);
    }catch(e){ msg.className="a-msg err"; msg.textContent=e.message; }
  };

  async function ladeVorlagen(){
    try{
      var d=await api("/admin/vorlagen");
      vorlagen=d.vorlagen||[]; platzhalter=d.platzhalter||[]; steuerzeichen=d.steuerzeichen||[];
    }catch(e){ vorlagen=[]; platzhalter=[]; }
  }

  /* Dialog: eine neue, eigene Vorlage anlegen (Titel + Schlüssel). */
  window.vorlageNeu=function(){
    var host=document.getElementById("aDetailHost");
    if(!host){host=document.createElement("div");host.id="aDetailHost";document.body.appendChild(host);}
    host.innerHTML=
      '<div class="a-modal-backdrop" data-aktion="schliesseDetail"></div>'
      +'<div class="a-modal" style="max-width:520px">'
      +  '<div class="a-modal-head"><div class="a-modal-title">Neue Vorlage</div>'
      +    '<button class="a-btn" data-aktion="schliesseDetail">Schließen</button></div>'
      +  '<div class="a-modal-sec">Titel</div>'
      +  '<div class="a-field"><input type="text" id="aNVTitel" placeholder="z.B. Zwischenzeugnis"></div>'
      +  '<div class="a-modal-sec">Schlüssel</div>'
      +  '<div class="a-field"><input type="text" id="aNVKey" placeholder="z.B. zwischenzeugnis"></div>'
      +  '<p style="font-size:11.5px;color:var(--text3);margin:6px 2px">Nur Kleinbuchstaben, Zahlen und Unterstrich, keine Leerzeichen. Der Schlüssel identifiziert die Vorlage und lässt sich später nicht ändern.</p>'
      +  '<div class="a-msg" id="aNVMsg"></div>'
      +  '<div class="a-modal-actions"><div style="flex:1"></div>'
      +    '<button class="a-btn a-btn-green" data-aktion="vorlageNeuAnlegen">Anlegen</button></div>'
      +'</div>';
    host.style.display="block";
    klicksAnmelden(host);
    var t=document.getElementById("aNVTitel"); if(t) t.focus();
  };

  window.vorlageNeuAnlegen=async function(){
    var msg=document.getElementById("aNVMsg"); msg.className="a-msg";
    var titel=(document.getElementById("aNVTitel").value||"").trim();
    var key=(document.getElementById("aNVKey").value||"").trim().toLowerCase();
    if(!titel){ msg.className="a-msg err"; msg.textContent="Bitte einen Titel angeben."; return; }
    if(!/^[a-z0-9_]+$/.test(key)){ msg.className="a-msg err"; msg.textContent="Schlüssel: nur Kleinbuchstaben, Zahlen und Unterstrich."; return; }
    if(vorlagen.some(function(v){return v.key===key;})){ msg.className="a-msg err"; msg.textContent="Diesen Schlüssel gibt es bereits."; return; }
    try{
      await api("/admin/vorlagen/speichern",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({key:key,titel:titel,text:""})});
      await ladeVorlagen(); render();
      vorlageOeffnen(key);   // direkt zum Bearbeiten öffnen
    }catch(e){ msg.className="a-msg err"; msg.textContent=e.message; }
  };

  /* Eine eigene Vorlage löschen (Standard-Vorlagen sind geschützt). */
  window.vorlageLoeschen=async function(key){
    aConfirm("Vorlage löschen", "„"+key+"\" wirklich löschen? Das lässt sich nicht rückgängig machen.", "danger", "Löschen", async function(){
    try{
      await api("/admin/vorlagen/loeschen",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({key:key})});
      await ladeVorlagen(); render();
    }catch(e){ aAlert("Fehler", e.message, "danger"); }
    });
  };

  window.schliesseDetail=function(){var h=document.getElementById("aDetailHost");if(h){h.style.display="none";h.innerHTML="";}};

  window.speichereDetail=async function(id){
    var msg=document.getElementById("aDMsg");msg.className="a-msg";
    var mods=[].slice.call(document.querySelectorAll("#aDMods .a-mod-chip.on")).map(function(c){return c.dataset.mod;});
    var payload={
      firma_id:id,
      name:document.getElementById("aDName").value.trim(),
      email:document.getElementById("aDEmail").value.trim(),
      adresse:document.getElementById("aDAdresse").value.trim(),
      plan:document.getElementById("aDPlan").value,
      rolle:document.getElementById("aDRolle").value,
      lizenzart:document.getElementById("aDLizenz")?document.getElementById("aDLizenz").value:null,
      max_firmen:document.getElementById("aDMax")?parseInt(document.getElementById("aDMax").value)||1:null,
      max_benutzer:maxBenutzerFeld("aDMaxBenutzer"),
      gueltig_bis:document.getElementById("aDGueltig").value||null,
      modules:mods,
      notes:document.getElementById("aDNotes").value
    };
    try{
      await api("/admin/firmen/update",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      msg.className="a-msg ok";msg.textContent="Gespeichert.";
      await ladeFirmen();render();
      setTimeout(schliesseDetail,700);
    }catch(e){msg.className="a-msg err";msg.textContent=e.message;}
  };
  window.passwortNeu=async function(id){
    var f=firmen.filter(function(x){return x.id===id;})[0];
    aConfirm("Neues Einmal-Passwort", "Für „"+(f?f.name:id)+"\" ein neues Einmal-Passwort erzeugen? Das bisherige Passwort wird sofort ungültig.", "warn", "Erzeugen", async function(){
    var box=document.getElementById("aPwNeu");
    try{
      var d=await api("/admin/firmen/passwort-neu",{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({firma_id:id})});
      box.innerHTML='<div style="background:rgba(16,185,129,.10);border:1px solid rgba(16,185,129,.3);'
        +'border-radius:10px;padding:12px 14px">'
        +'<div style="font-size:11.5px;color:var(--text3);margin-bottom:6px">'
        +'Einmal-Passwort für '+esc(d.email)+' – jetzt notieren, es wird nicht noch einmal angezeigt:</div>'
        +'<div style="font-family:var(--mono);font-size:17px;color:var(--gruen);letter-spacing:.04em">'+esc(d.passwort)+'</div>'
        +'<div style="font-size:11.5px;color:var(--text3);margin-top:8px">'
        +'Der Kunde meldet sich damit an und legt unter Einstellungen ein eigenes Passwort fest.</div></div>';
    }catch(e){
      box.innerHTML='<div style="color:var(--rot);font-size:12px">'+esc(e.message)+'</div>';
    }
    });
  };

  window.passwortAusAnfrage=async function(firmaId, anfrageId){
    var box=document.getElementById("aAnfragePw");
    try{
      var d=await api("/admin/firmen/passwort-neu",{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({firma_id:firmaId})});
      box.innerHTML='<div style="background:rgba(16,185,129,.10);border:1px solid rgba(16,185,129,.3);'
        +'border-radius:10px;padding:14px 16px">'
        +'<div style="font-size:11.5px;color:var(--text3);margin-bottom:6px">'
        +'Einmal-Passwort für '+esc(d.email)+' – jetzt notieren und dem Kunden durchgeben:</div>'
        +'<div style="font-family:var(--mono);font-size:18px;color:var(--gruen);letter-spacing:.04em">'+esc(d.passwort)+'</div>'
        +'<div style="font-size:11.5px;color:var(--text3);margin-top:8px">'
        +'Der Kunde setzt damit auf der Anmeldeseite unter "Passwort vergessen" sein eigenes Passwort.</div></div>';
      await ladeAnfragen(); render();
      var b2=document.getElementById("aAnfragePw"); if(b2) b2.innerHTML=box.innerHTML;
    }catch(e){ box.innerHTML='<div style="color:var(--rot);font-size:12px">'+esc(e.message)+'</div>'; }
  };
  window.profilFreigeben=async function(firmaId){
    aConfirm("Firmenprofil freigeben", "Der Kunde darf danach einmal ändern.", "warn", "Freigeben", async function(){
    try{
      await api("/admin/firmenprofil/freigeben",{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({firma_id:firmaId})});
      await ladeAnfragen(); render();
    }catch(e){ aAlert("Fehler", e.message, "danger"); }
    });
  };

  window.anfrageErledigt=async function(id){
    try{
      await api("/admin/passwort-anfragen/erledigt",{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({id:id})});
      await ladeAnfragen(); render();
    }catch(e){ aAlert("Fehler", e.message, "danger"); }
  };
  async function ladeAnfragen(){
    try{ var d=await api("/admin/passwort-anfragen"); anfragen=d.anfragen||[]; }catch(e){ anfragen=[]; }
  }

  window.sperrenAusDetail=async function(id,sperr){
    try{await api("/admin/firmen/update",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({firma_id:id,gesperrt:sperr})});
      await ladeFirmen();render();schliesseDetail();}catch(e){aAlert("Fehler",e.message,"danger");}
  };
  window.loeschenAusDetail=async function(id){schliesseDetail();loeschen(id);};

  /* ── Plan bearbeiten / neu anlegen ── */
  window.oeffnePlan=function(id){
    var p=id?plaene.filter(function(x){return x.id===id;})[0]:null;
    var neu=!p;
    if(!p)p={key:"",name:"",preis_monat:0,preis_jahr:0,beschreibung:"",features:[],modules:[],
             aktiv:true,empfohlen:false,sortierung:plaene.length,aktion_text:"",aktion_prozent:0,aktion_bis:null};
    var host=document.getElementById("aDetailHost");
    if(!host){host=document.createElement("div");host.id="aDetailHost";document.body.appendChild(host);}
    var modChips=ALLE_MODULE.map(function(m){
      var on=(p.modules||[]).indexOf(m.id)>=0;
      return '<button class="a-mod-chip'+(on?' on':'')+'" data-mod="'+m.id+'" data-chip="1">'+esc(m.label)+'</button>';
    }).join("");
    host.innerHTML=
      '<div class="a-modal-backdrop" data-aktion="schliesseDetail"></div>'
      +'<div class="a-modal">'
      +  '<div class="a-modal-head"><div><div class="a-modal-title">'+(neu?"Neuer Plan":esc(p.name))+'</div>'
      +    '<div class="a-modal-sub">'+(neu?"Plan anlegen":"Schlüssel: "+esc(p.key))+'</div></div>'
      +    '<button class="a-btn" data-aktion="schliesseDetail">Schließen</button></div>'

      +  '<div class="a-modal-sec">Grunddaten</div>'
      +  '<div class="a-modal-grid">'
      +    '<div class="a-field"><label>Anzeigename</label><input type="text" id="aPName" value="'+esc(p.name)+'" placeholder="z.B. Business"></div>'
      +    '<div class="a-field"><label>Schlüssel (intern)</label><input type="text" id="aPKey" value="'+esc(p.key)+'" placeholder="business"'+(neu?'':' readonly style="opacity:.6"')+'></div>'
      +    '<div class="a-field" style="grid-column:1/-1"><label>Beschreibung</label><input type="text" id="aPBeschr" value="'+esc(p.beschreibung)+'" placeholder="Kurzer Text unter dem Namen"></div>'
      +  '</div>'

      +  '<div class="a-modal-sec">Preise</div>'
      +  '<div class="a-modal-grid">'
      +    '<div class="a-field"><label>Preis / Monat (€)</label><input type="number" step="0.01" id="aPPreisM" value="'+(p.preis_monat||0)+'"></div>'
      +    '<div class="a-field"><label>Preis / Jahr (€)</label><input type="number" step="0.01" id="aPPreisJ" value="'+(p.preis_jahr||0)+'"></div>'
      +  '</div>'

      +  '<div class="a-modal-sec">Aktion / Rabatt</div>'
      +  '<div class="a-modal-grid">'
      +    '<div class="a-field"><label>Aktionstext</label><input type="text" id="aPAktText" value="'+esc(p.aktion_text)+'" placeholder="z.B. Sommeraktion"></div>'
      +    '<div class="a-field"><label>Rabatt (%)</label><input type="number" step="1" min="0" max="100" id="aPAktProz" value="'+(p.aktion_prozent||0)+'"></div>'
      +    '<div class="a-field"><label>Aktion gültig bis</label><input type="date" id="aPAktBis" value="'+esc(p.aktion_bis||"")+'"></div>'
      +    '<div class="a-field"><label>&nbsp;</label><div id="aPVorschau" style="font-size:12.5px;color:var(--text3);padding-top:9px">–</div></div>'
      +  '</div>'

      +  '<div class="a-modal-sec">Leistungen (eine pro Zeile)</div>'
      +  '<textarea id="aPFeatures" class="a-textarea" placeholder="Alle Module\nUnbegrenzte Fahrer\nSupport">'+esc((p.features||[]).join("\n"))+'</textarea>'

      +  '<div class="a-modal-sec">Enthaltene Module</div>'
      +  '<div class="a-mods" id="aPMods">'+modChips+'</div>'

      +  '<div class="a-modal-sec">Anzeige</div>'
      +  '<div class="a-modal-grid">'
      +    '<div class="a-field"><label>Auf Website sichtbar</label><select id="aPAktiv"><option value="1"'+(p.aktiv?' selected':'')+'>Ja</option><option value="0"'+(p.aktiv?'':' selected')+'>Nein</option></select></div>'
      +    '<div class="a-field"><label>Als "empfohlen" hervorheben</label><select id="aPEmpf"><option value="1"'+(p.empfohlen?' selected':'')+'>Ja</option><option value="0"'+(p.empfohlen?'':' selected')+'>Nein</option></select></div>'
      +    '<div class="a-field"><label>Reihenfolge</label><input type="number" id="aPSort" value="'+(p.sortierung||0)+'"></div>'
      +  '</div>'

      +  '<div class="a-msg" id="aPMsg"></div>'
      +  '<div class="a-modal-actions">'
      +    (neu?'':'<button class="a-btn a-btn-red" data-aktion="loeschePlan" data-args="['+p.id+']">Plan löschen</button>')
      +    '<div style="flex:1"></div>'
      +    '<button class="a-btn a-btn-green" data-aktion="speicherePlan" data-args="['+(p.id||"null")+']">Speichern</button>'
      +  '</div>'
      +'</div>';
    host.style.display="block";
    klicksAnmelden(host);
    aktualisiereVorschau();
    ["aPPreisM","aPAktProz"].forEach(function(id){
      var el=document.getElementById(id); if(el)el.addEventListener("input",aktualisiereVorschau);
    });
  };

  function aktualisiereVorschau(){
    var v=document.getElementById("aPVorschau"); if(!v)return;
    var preis=parseFloat(document.getElementById("aPPreisM").value)||0;
    var proz=parseFloat(document.getElementById("aPAktProz").value)||0;
    v.innerHTML = proz>0
      ? 'Mit Aktion: <b style="color:var(--gruen)">'+eur(preis*(1-proz/100))+'</b>'
      : 'Kein Rabatt aktiv';
  }

  window.speicherePlan=async function(id){
    var msg=document.getElementById("aPMsg"); msg.className="a-msg";
    var feats=document.getElementById("aPFeatures").value.split("\n")
      .map(function(z){return z.trim();}).filter(function(z){return z;});
    var mods=[].slice.call(document.querySelectorAll("#aPMods .a-mod-chip.on")).map(function(c){return c.dataset.mod;});
    var payload={
      id:id||null,
      key:document.getElementById("aPKey").value.trim().toLowerCase(),
      name:document.getElementById("aPName").value.trim(),
      preis_monat:parseFloat(document.getElementById("aPPreisM").value)||0,
      preis_jahr:parseFloat(document.getElementById("aPPreisJ").value)||0,
      beschreibung:document.getElementById("aPBeschr").value.trim(),
      features:feats, modules:mods,
      aktiv:document.getElementById("aPAktiv").value==="1",
      empfohlen:document.getElementById("aPEmpf").value==="1",
      sortierung:parseInt(document.getElementById("aPSort").value)||0,
      aktion_text:document.getElementById("aPAktText").value.trim(),
      aktion_prozent:parseFloat(document.getElementById("aPAktProz").value)||0,
      aktion_bis:document.getElementById("aPAktBis").value||null
    };
    if(!payload.key){msg.className="a-msg err";msg.textContent="Schlüssel darf nicht leer sein.";return;}
    if(!payload.name){msg.className="a-msg err";msg.textContent="Name darf nicht leer sein.";return;}
    try{
      await api("/admin/plaene/speichern",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      msg.className="a-msg ok";msg.textContent="Gespeichert.";
      await ladePlaene(); render();
      setTimeout(schliesseDetail,600);
    }catch(e){msg.className="a-msg err";msg.textContent=e.message;}
  };

  window.loeschePlan=async function(id){
    var p=plaene.filter(function(x){return x.id===id;})[0];
    aConfirm("Plan löschen", "„"+(p?p.name:id)+"\" wirklich löschen?", "danger", "Löschen", async function(){
    try{
      await api("/admin/plaene/loeschen",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:id})});
      schliesseDetail(); await ladePlaene(); render();
    }catch(e){aAlert("Fehler",e.message,"danger");}
    });
  };

  async function ladePlaene(){
    try{var d=await api("/admin/plaene");plaene=d.plaene||[];}catch(e){plaene=[];}
  }

  /* ── Start: Zugriff prüfen ── */
  async function init(){
    setupNav();
    try{
      var me=await api("/me");
      ICH.superadmin=!!me.superadmin; ICH.rolle=me.rolle||"benutzer"; ICH.email=me.email||"";
      if(!me.superadmin && me.rolle!=="admin"){
        document.getElementById("aWrap").classList.add("a-hidden");
        document.getElementById("aDenied").classList.remove("a-hidden");
        return;
      }
      document.getElementById("aFoot").textContent=me.email||"";
      await ladeFirmen();
      await ladePlaene();
      await ladeAnfragen();
      if (ICH.superadmin) await ladeVorlagen();
      render();
    }catch(e){
      document.getElementById("aWrap").classList.add("a-hidden");
      document.getElementById("aDenied").classList.remove("a-hidden");
    }
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
  else init();
})();
