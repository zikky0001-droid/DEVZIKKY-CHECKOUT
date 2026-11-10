(() => {
  const projects = [
    {name:'DEV ZIKKY PAIR',type:'WhatsApp bot utility',url:'https://dev-zikky-pair.onrender.com'},
    {name:'ZQUOTE',type:'Quote image API',url:'https://zquote-tau.vercel.app'},
    {name:'ZMAIL Studio',type:'Email workspace & API',url:'https://zmail.zone.id'},
    {name:'ZMAIL Drop',type:'Temporary inbox',url:'https://zmaildrop.vercel.app'},
    {name:'ZDROPMAIL',type:'Temporary inbox',url:'https://zdropmail.vercel.app'},
    {name:'ZIKKY AI v1',type:'AI assistant',url:'https://zikky-ai.xo.je'},
    {name:'ZIKKY AI v2',type:'AI assistant experiment',url:'https://zikkyai.onrender.com'},
    {name:'ZIKKY Manga Hub',type:'Manga reader',url:'https://zikkymangahub.onrender.com'},
    {name:'ZIKKY Calculator',type:'Web utility',url:'https://zikkycal.netlify.app'},
    {name:'ZIKKY Telegram Bot',type:'Telegram automation',url:'https://t.me/zbot101bot'},
    {name:'Phishing Edu',type:'Security awareness project',url:'https://zikkyphishing.netlify.app'},
    {name:'DEVZIKKY PAY',type:'Checkout & platform',url:'/'}
  ];
  const links = [
    {name:'GitHub',detail:'zikky0001-droid',url:'https://github.com/zikky0001-droid',icon:'⌘'},
    {name:'Portfolio',detail:'zikkytech.xo.je',url:'https://zikkytech.xo.je',icon:'↗'},
    {name:'Instagram',detail:'@devzikky',url:'https://www.instagram.com/devzikky',icon:'◎'},
    {name:'YouTube',detail:'@devzikky',url:'https://m.youtube.com/@devzikky',icon:'▶'},
    {name:'TikTok',detail:'@devzikky',url:'https://www.tiktok.com/@devzikky',icon:'♪'},
    {name:'Telegram',detail:'@devzikky',url:'https://t.me/devzikky',icon:'➤'},
    {name:'Email',detail:'zikkystar0001@gmail.com',url:'mailto:zikkystar0001@gmail.com',icon:'@'}
  ];
  const target = document.getElementById('siteFooter');
  if (!target) return;
  const safe = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  target.innerHTML = `
    <footer class="site-footer">
      <div class="footer-shell">
        <div class="footer-intro">
          <div><span class="footer-kicker">THE PERSON. THE PROJECTS. THE WORK.</span><h2>Built with curiosity.<br><span>Improved with every release.</span></h2><p>DEVZIKKY TECH is a growing collection of experiments and useful tools across web development, AI, APIs, email workflows, bots and developer utilities.</p></div>
          <a class="footer-portfolio" href="/donate">Donate &amp; Support Us ↗</a><a class="footer-portfolio" href="https://zikkytech.xo.je" target="_blank" rel="noopener noreferrer">More about DEVZIKKY <b>↗</b><small>zikkytech.xo.je</small></a>
        </div>
        <div class="footer-project-head"><div><span class="footer-kicker">PROJECT DIRECTORY</span><h3>Explore the wider ecosystem</h3><p>Projects listed in the DEVZIKKY portfolio, plus this checkout platform.</p></div><a href="/projects" class="footer-small-link">Open project directory ↗</a></div>
        <div class="footer-project-grid">${projects.map(p => `<a class="footer-project" href="${safe(p.url)}" ${p.url.startsWith('http')?'target="_blank" rel="noopener noreferrer"':''}><span><strong>${safe(p.name)}</strong><small>${safe(p.type)}</small></span><b>↗</b></a>`).join('')}</div>
        <div class="footer-links-head"><div><span class="footer-kicker">PUBLIC LINKS</span><h3>Connect and follow the work</h3></div></div>
        <div class="footer-link-grid">${links.map(l => `<a class="footer-link" href="${safe(l.url)}" ${l.url.startsWith('mailto:')?'':'target="_blank" rel="noopener noreferrer"'}><i>${safe(l.icon)}</i><span><strong>${safe(l.name)}</strong><small>${safe(l.detail)}</small></span><b>↗</b></a>`).join('')}</div>
        <div class="footer-bottom"><div><strong>DEVZIKKY <span>PAY</span></strong><p>Payment information, project support and developer-built tools.</p></div><div class="footer-bottom-nav"><a href="/">Home</a><a href="/about">About</a><a href="/projects">Projects</a><a href="/support">Support info</a><a href="/donate">Donate &amp; Support Us</a><a href="/roadmap">Roadmap</a><a href="/faq">FAQ</a><a href="/privacy">Privacy</a><a href="/statistics">Statistics</a><a href="/api">API docs</a><a href="/control-room">Control Room</a></div><p class="footer-copy">© <span data-year>${new Date().getFullYear()}</span> DEVZIKKY TECH. Visit <a href="https://zikkytech.xo.je" target="_blank" rel="noopener noreferrer">zikkytech.xo.je</a> for the full portfolio.</p></div>
      </div>
    </footer>`;
})();
