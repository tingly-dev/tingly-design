export const BOARD = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>Profile 切换器</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<style>
body{margin:0;font-family:system-ui,sans-serif;color:#1f2430}
</style>
</helmet>
<div style="width:1200px;height:760px;display:flex;background:#f5f6f8">
  <div style="width:76px;background:#ffffff">
    <sc-for list="{{rail}}" as="r" hint-placeholder-count="7">
      <div style="height:54px;background:{{r.bg}}">{{r.label}}</div>
    </sc-for>
  </div>
  <div style="flex:1;padding:28px 32px;display:flex;flex-direction:column;gap:16px">
    <h1 style="font-size:20px;font-weight:700" class='title'>Claude Code</h1>
    <p style="color:#5b6475">A &amp; B — 切换器</p>
    <ul style="margin:0">
      <li>One</li>
      <li>Two</li>
    </ul>
    <svg width="20" height="20" viewBox="0 0 20 20"><path d="M2 2 L18 18" stroke-width="2"/></svg>
  </div>
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"accent":{"editor":"color","default":"#3b6df0"},"note":{"editor":"text","default":"it&#39;s"},"$preview":{"width":1200,"height":760}}'>
class Component extends DCLogic {
  renderVals() {
    return { rail: [{ label: 'Home', bg: '#e8efff' }] };
  }
}
</script>
</body>
</html>
`;
