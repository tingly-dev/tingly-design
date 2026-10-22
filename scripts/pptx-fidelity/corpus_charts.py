"""The charts deck of corpus.py: one chart per slide, python-pptx's own where it writes the type,
hand-written chart parts where it cannot (combinations, stock, bar of pie, surface, 3-D, trendlines,
error bars, dates, logarithmic axes and the Office 2016 charts)."""
from lxml import etree
from pptx.chart.data import BubbleChartData, CategoryChartData, XyChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION, XL_LEGEND_POSITION
from pptx.opc.package import Part
from pptx.opc.packuri import PackURI
from pptx.oxml import parse_xml
from pptx.util import Inches, Pt

C = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex'
CATS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
X, Y, W, H = Inches(0.8), Inches(1.0), Inches(11.7), Inches(6.2)


def add(prs, title, chart_type, data, **opts):
    from corpus import title as heading
    s = prs.slides.add_slide(prs.slide_layouts[6])
    heading(s, title)
    frame = s.shapes.add_chart(chart_type, X, Y, W, H, data)
    chart = frame.chart
    chart.font.size = Pt(12)
    for k, v in opts.items():
        setattr(chart, k, v)
    return s, frame, chart


def cat_data(series, cats=CATS, fmt=None):
    d = CategoryChartData(number_format=fmt) if fmt else CategoryChartData()
    d.categories = cats
    for name, vals in series:
        d.add_series(name, vals)
    return d


def pts(vals, fmt='General'):
    body = ''.join(f'<c:pt idx="{i}"><c:v>{v}</c:v></c:pt>' for i, v in enumerate(vals) if v is not None)
    return f'<c:numRef><c:f>Sheet1!$B$2</c:f><c:numCache><c:formatCode>{fmt}</c:formatCode><c:ptCount val="{len(vals)}"/>{body}</c:numCache></c:numRef>'


def strs(vals):
    body = ''.join(f'<c:pt idx="{i}"><c:v>{v}</c:v></c:pt>' for i, v in enumerate(vals))
    return f'<c:strRef><c:f>Sheet1!$A$2</c:f><c:strCache><c:ptCount val="{len(vals)}"/>{body}</c:strCache></c:strRef>'


def ser(i, name, vals, cats=CATS, extra='', fmt='General', kind='val'):
    return (f'<c:ser><c:idx val="{i}"/><c:order val="{i}"/><c:tx>{strs([name]).replace("strRef", "strRef")}</c:tx>{extra}'
            f'<c:cat>{strs(cats)}</c:cat><c:{kind}>{pts(vals, fmt)}</c:{kind}></c:ser>')


def space(plot, title='', legend='b', extra=''):
    t = f'<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>{title}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>' if title else '<c:autoTitleDeleted val="1"/>'
    leg = f'<c:legend><c:legendPos val="{legend}"/><c:overlay val="0"/></c:legend>' if legend else ''
    return (f'<c:chartSpace xmlns:c="{C}" xmlns:a="{A}" xmlns:r="{R}"><c:roundedCorners val="0"/><c:chart>{t}{extra}<c:plotArea><c:layout/>{plot}</c:plotArea>{leg}<c:plotVisOnly val="1"/></c:chart>'
            f'<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr></c:chartSpace>')


def axes(cat='catAx', ids=('1', '2'), val_extra='', cat_extra='', pos=('b', 'l'), grid=True):
    g = '<c:majorGridlines/>' if grid else ''
    return (f'<c:{cat}><c:axId val="{ids[0]}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="{pos[0]}"/>{cat_extra}<c:crossAx val="{ids[1]}"/></c:{cat}>'
            f'<c:valAx><c:axId val="{ids[1]}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="{pos[1]}"/>{g}{val_extra}<c:crossAx val="{ids[0]}"/></c:valAx>')


def custom(prs, title, xml):
    """A slide with a chart whose part is replaced by hand-written XML."""
    s, frame, chart = add(prs, title, XL_CHART_TYPE.COLUMN_CLUSTERED, cat_data([('S', (1, 2, 3, 4, 5, 6))]))
    chart.part._element = parse_xml(xml.encode())
    return s


def chartex(prs, title, layout, data_xml, series_extra='', axes_xml='', legend=False):
    """An Office 2016 chart: its own part, drawn by the slide through alternate content."""
    from corpus import title as heading
    s = prs.slides.add_slide(prs.slide_layouts[6])
    heading(s, title)
    n = len([p for p in prs.part.package.iter_parts() if 'chartEx' in str(p.partname)]) + 1
    xml = (f'<cx:chartSpace xmlns:a="{A}" xmlns:r="{R}" xmlns:cx="{CX}"><cx:chartData>{data_xml}</cx:chartData><cx:chart>'
           f'<cx:title pos="t" align="ctr" overlay="0"><cx:tx><cx:txData><cx:v>{title}</cx:v></cx:txData></cx:tx></cx:title>'
           f'<cx:plotArea><cx:plotAreaRegion><cx:series layoutId="{layout}" uniqueId="{{00000000-0000-0000-0000-00000000000{n}}}"><cx:tx><cx:txData><cx:f>Sheet1!$B$1</cx:f><cx:v>Sales</cx:v></cx:txData></cx:tx>'
           f'<cx:dataLabels pos="outEnd"><cx:visibility seriesName="0" categoryName="0" value="1"/></cx:dataLabels><cx:dataId val="0"/>{series_extra}</cx:series></cx:plotAreaRegion>{axes_xml}</cx:plotArea>'
           f'{"<cx:legend pos=" + chr(34) + "b" + chr(34) + " align=" + chr(34) + "ctr" + chr(34) + " overlay=" + chr(34) + "0" + chr(34) + "/>" if legend else ""}</cx:chart></cx:chartSpace>')
    part = Part(PackURI(f'/ppt/charts/chartEx{n}.xml'), 'application/vnd.ms-office.chartex+xml', prs.part.package, xml.encode())
    rid = s.part.relate_to(part, 'http://schemas.microsoft.com/office/2014/relationships/chartEx')
    frame = (f'<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:cx1="http://schemas.microsoft.com/office/drawing/2015/9/8/chartex" Requires="cx1">'
             f'<p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="{A}"><p:nvGraphicFramePr><p:cNvPr id="{100 + n}" name="Chart {n}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>'
             f'<p:xfrm><a:off x="{X}" y="{Y}"/><a:ext cx="{W}" cy="{H}"/></p:xfrm><a:graphic><a:graphicData uri="{CX}"><cx:chart xmlns:cx="{CX}" xmlns:r="{R}" r:id="{rid}"/></a:graphicData></a:graphic></p:graphicFrame></mc:Choice>'
             f'<mc:Fallback><p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="{A}"><p:nvSpPr><p:cNvPr id="{200 + n}" name="Fallback {n}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{X}" y="{Y}"/><a:ext cx="{W}" cy="{H}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
             f'<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>This chart isn\'t available in your version of PowerPoint</a:t></a:r></a:p></p:txBody></p:sp></mc:Fallback></mc:AlternateContent>')
    s.shapes._spTree.append(etree.fromstring(frame))
    return s


def cx_data(cats, vals, levels=None, fmt='General'):
    lv = levels or [cats]
    strdim = ''.join(f'<cx:lvl ptCount="{len(l)}">' + ''.join(f'<cx:pt idx="{i}">{v}</cx:pt>' for i, v in enumerate(l)) + '</cx:lvl>' for l in lv) if cats else ''
    cat = f'<cx:strDim type="cat"><cx:f>Sheet1!$A$2</cx:f>{strdim}</cx:strDim>' if cats else ''
    num = f'<cx:numDim type="{"size" if levels else "val"}"><cx:f>Sheet1!$B$2</cx:f><cx:lvl ptCount="{len(vals)}" formatCode="{fmt}">' + ''.join(f'<cx:pt idx="{i}">{v}</cx:pt>' for i, v in enumerate(vals)) + '</cx:lvl></cx:numDim>'
    return f'<cx:data id="0">{cat}{num}</cx:data>'


def charts(out):
    from corpus import deck
    prs = deck()
    q = [('North', (12, 15, 18, 22, 19, 25)), ('South', (8, 11, 9, 14, 16, 13)), ('West', (5, 7, 10, 9, 12, 15))]
    _, _, c = add(prs, 'Clustered column: labels, axis titles, number format', XL_CHART_TYPE.COLUMN_CLUSTERED, cat_data(q, fmt='#,##0'), has_legend=True)
    c.legend.position = XL_LEGEND_POSITION.BOTTOM; c.legend.include_in_layout = False
    c.plots[0].has_data_labels = True; c.plots[0].data_labels.number_format = '#,##0"k"'; c.plots[0].data_labels.number_format_is_linked = False
    c.plots[0].data_labels.position = XL_LABEL_POSITION.OUTSIDE_END
    c.value_axis.has_title = True; c.value_axis.axis_title.text_frame.text = 'Units'
    c.category_axis.has_title = True; c.category_axis.axis_title.text_frame.text = 'Month'
    _, _, c = add(prs, 'Stacked bar', XL_CHART_TYPE.BAR_STACKED, cat_data(q), has_legend=True)
    _, _, c = add(prs, '100% stacked column', XL_CHART_TYPE.COLUMN_STACKED_100, cat_data(q), has_legend=True)
    _, _, c = add(prs, 'Line with markers, one smooth', XL_CHART_TYPE.LINE_MARKERS, cat_data(q), has_legend=True)
    c.plots[0].series[1].smooth = True
    _, _, c = add(prs, 'Stacked area', XL_CHART_TYPE.AREA_STACKED, cat_data(q), has_legend=True)
    _, _, c = add(prs, 'Pie: percentages, one slice pulled out', XL_CHART_TYPE.PIE, cat_data([('Share', (35, 25, 20, 12, 8))], cats=['A', 'B', 'C', 'D', 'E']), has_legend=True)
    c.plots[0].has_data_labels = True; c.plots[0].data_labels.show_percentage = True; c.plots[0].data_labels.show_value = False
    c.plots[0].series[0].points[0].format.fill.solid()
    c.plots[0].series[0].points[1].explosion = 15
    _, _, c = add(prs, 'Doughnut, two rings', XL_CHART_TYPE.DOUGHNUT, cat_data([('2023', (30, 40, 30)), ('2024', (25, 45, 30))], cats=['X', 'Y', 'Z']), has_legend=True)
    xy = XyChartData()
    for name, pts_ in (('Trial A', [(1, 2.1), (2, 3.9), (3, 6.2), (4, 7.8), (5, 10.1), (6, 12.2)]), ('Trial B', [(1, 1.0), (2.5, 2.0), (3.5, 4.5), (5, 5.0), (6, 7.5)])):
        sr = xy.add_series(name)
        for x_, y_ in pts_:
            sr.add_data_point(x_, y_)
    _, frame, c = add(prs, 'Scatter with a trendline and its equation', XL_CHART_TYPE.XY_SCATTER_LINES, xy, has_legend=True)
    sx = c.plots[0].series[0]._element
    tl = parse_xml(f'<c:trendline xmlns:c="{C}"><c:trendlineType val="linear"/><c:dispRSqr val="1"/><c:dispEq val="1"/></c:trendline>')
    sx.insert(sx.index(sx.find(f'{{{C}}}xVal')), tl)
    b = BubbleChartData()
    sr = b.add_series('Products')
    for x_, y_, z_ in ((1, 10, 4), (2, 14, 9), (3, 7, 2), (4, 18, 12), (5, 12, 6)):
        sr.add_data_point(x_, y_, z_)
    add(prs, 'Bubbles', XL_CHART_TYPE.BUBBLE, b, has_legend=False)
    add(prs, 'Radar with markers', XL_CHART_TYPE.RADAR_MARKERS, cat_data(q[:2]), has_legend=True)
    add(prs, 'Filled radar', XL_CHART_TYPE.RADAR_FILLED, cat_data(q[:2]), has_legend=True)
    many = [(f'S{i + 1}', tuple((i * 3 + k * 2) % 17 + 3 for k in range(6))) for i in range(9)]
    add(prs, 'Nine series: colours past the six accents', XL_CHART_TYPE.COLUMN_CLUSTERED, cat_data(many), has_legend=True)
    # hand-written parts
    combo = (f'<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>{ser(0, "Revenue", (120, 135, 150, 170, 160, 190), fmt="$#,##0")}'
             f'<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls><c:gapWidth val="80"/><c:axId val="1"/><c:axId val="2"/></c:barChart>'
             f'<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>{ser(1, "Margin", (0.12, 0.15, 0.14, 0.18, 0.2, 0.22), fmt="0%", extra="<c:marker><c:symbol val=" + chr(34) + "circle" + chr(34) + "/><c:size val=" + chr(34) + "7" + chr(34) + "/></c:marker>")}<c:marker val="1"/><c:axId val="3"/><c:axId val="4"/></c:lineChart>'
             + axes(ids=('1', '2'), val_extra='<c:numFmt formatCode="$#,##0" sourceLinked="0"/><c:title><c:tx><c:rich><a:bodyPr rot="-5400000"/><a:p><a:r><a:t>Revenue</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>')
             + f'<c:catAx><c:axId val="3"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/><c:axPos val="b"/><c:crossAx val="4"/></c:catAx>'
             f'<c:valAx><c:axId val="4"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="r"/><c:numFmt formatCode="0%" sourceLinked="0"/><c:crossAx val="3"/><c:crosses val="max"/></c:valAx>')
    custom(prs, 'Column and line on a secondary axis', space(combo, 'Revenue and margin'))
    stock_cats = ['1/2', '1/3', '1/4', '1/5', '1/6', '1/7']
    stock = (f'<c:stockChart>{ser(0, "Open", (44, 25, 38, 50, 34, 42), cats=stock_cats, extra="<c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val=" + chr(34) + "none" + chr(34) + "/></c:marker>")}'
             f'{ser(1, "High", (55, 57, 57, 58, 58, 53), cats=stock_cats, extra="<c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val=" + chr(34) + "none" + chr(34) + "/></c:marker>")}'
             f'{ser(2, "Low", (11, 12, 13, 11, 25, 19), cats=stock_cats, extra="<c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val=" + chr(34) + "none" + chr(34) + "/></c:marker>")}'
             f'{ser(3, "Close", (25, 38, 50, 35, 43, 30), cats=stock_cats, extra="<c:spPr><a:ln><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val=" + chr(34) + "none" + chr(34) + "/></c:marker>")}'
             f'<c:hiLowLines/><c:upDownBars><c:gapWidth val="150"/><c:upBars/><c:downBars/></c:upDownBars><c:axId val="1"/><c:axId val="2"/></c:stockChart>' + axes())
    custom(prs, 'Stock: open, high, low, close', space(stock, 'Share price', legend=''))
    ofpie = (f'<c:ofPieChart><c:ofPieType val="bar"/><c:varyColors val="1"/>{ser(0, "Spend", (40, 25, 15, 8, 7, 5), cats=["Rent", "Staff", "Ads", "Travel", "Tools", "Other"])}'
             f'<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="1"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/></c:dLbls>'
             f'<c:gapWidth val="100"/><c:splitType val="pos"/><c:splitPos val="3"/><c:secondPieSize val="75"/><c:serLines/></c:ofPieChart>')
    custom(prs, 'Bar of pie', space(ofpie, 'Where the money goes', legend=''))
    pie_of = ofpie.replace('<c:ofPieType val="bar"/>', '<c:ofPieType val="pie"/>')
    custom(prs, 'Pie of pie', space(pie_of, 'Where the money goes', legend=''))
    surf = ''.join(ser(i, f'Row {i + 1}', tuple(((k - 2.5) ** 2 + (i - 2) ** 2) * 3 for k in range(6))) for i in range(5))
    surface = f'<c:surfaceChart><c:wireframe val="0"/>{surf}<c:axId val="1"/><c:axId val="2"/><c:axId val="3"/></c:surfaceChart>' + axes() + '<c:serAx><c:axId val="3"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:serAx>'
    custom(prs, 'Surface (contour)', space(surface, 'Surface', extra='<c:view3D><c:rotX val="90"/><c:rotY val="0"/><c:rAngAx val="0"/><c:perspective val="0"/></c:view3D>'))
    col3d = f'<c:bar3DChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>{ser(0, "North", q[0][1])}{ser(1, "South", q[1][1])}<c:gapWidth val="150"/><c:shape val="box"/><c:axId val="1"/><c:axId val="2"/><c:axId val="0"/></c:bar3DChart>' + axes()
    custom(prs, '3-D column (drawn flat)', space(col3d, '3-D column', extra='<c:view3D><c:rotX val="15"/><c:rotY val="20"/><c:rAngAx val="1"/></c:view3D>'))
    dates = [45292, 45323, 45352, 45383, 45413, 45444]
    dl = (f'<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx>{strs(["Visitors"])}</c:tx><c:marker><c:symbol val="none"/></c:marker>'
          f'<c:cat>{pts(dates, "mmm yy")}</c:cat><c:val>{pts((1200, 1500, 1350, 2100, 2600, 3100))}</c:val></c:ser><c:marker val="1"/><c:axId val="1"/><c:axId val="2"/></c:lineChart>'
          + axes(cat='dateAx', cat_extra='<c:numFmt formatCode="mmm yy" sourceLinked="1"/>', val_extra='<c:numFmt formatCode="#,##0" sourceLinked="0"/>'))
    custom(prs, 'Date axis and thousands', space(dl, 'Visitors', legend=''))
    err = (f'<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>'
           f'{ser(0, "Growth", (3, 30, 300, 3000, 30000, 300000), extra="<c:errBars><c:errDir val=" + chr(34) + "y" + chr(34) + "/><c:errBarType val=" + chr(34) + "both" + chr(34) + "/><c:errValType val=" + chr(34) + "percentage" + chr(34) + "/><c:val val=" + chr(34) + "20" + chr(34) + "/></c:errBars>").replace("<c:cat>", "<c:cat>", 1)}'
           f'<c:gapWidth val="150"/><c:axId val="1"/><c:axId val="2"/></c:barChart>'
           + axes(val_extra='').replace('<c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>', '<c:logBase val="10"/><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>'))
    # error bars come after the categories and values in the schema
    err = err.replace('<c:errBars>', '<c:errBarsX>').replace('</c:errBars>', '</c:errBarsX>')
    import re as _re
    m = _re.search(r'<c:errBarsX>.*?</c:errBarsX>', err)
    err = err.replace(m.group(0), '').replace('</c:val></c:ser>', '</c:val>' + m.group(0).replace('errBarsX', 'errBars') + '</c:ser>', 1)
    err = err.replace('</c:val><c:errBars>', '</c:val><c:errBars>')
    custom(prs, 'Logarithmic axis with error bars', space(err, 'Growth', legend=''))
    # Office 2016 charts
    chartex(prs, 'Waterfall', 'waterfall', cx_data(['Start', 'Sales', 'Services', 'Costs', 'Tax', 'End'], [100, 40, 25, -45, -20, 100]),
            '<cx:layoutPr><cx:subtotals><cx:idx val="0"/><cx:idx val="5"/></cx:subtotals></cx:layoutPr>', legend=True,
            axes_xml='<cx:axis id="0"><cx:catScaling gapWidth="0.5"/><cx:tickLabels/></cx:axis><cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis>')
    chartex(prs, 'Funnel', 'funnel', cx_data(['Visits', 'Sign-ups', 'Trials', 'Paid', 'Renewed'], [5000, 2100, 900, 420, 300]),
            axes_xml='<cx:axis id="0"><cx:catScaling gapWidth="0.06"/><cx:tickLabels/></cx:axis>')
    import random
    rnd = random.Random(7)
    samples = [round(rnd.gauss(50, 12), 1) for _ in range(120)]
    chartex(prs, 'Histogram', 'clusteredColumn', cx_data(None, samples), '<cx:layoutPr><cx:binning intervalClosed="r"><cx:binCount val="8"/></cx:binning></cx:layoutPr>',
            axes_xml='<cx:axis id="0"><cx:catScaling gapWidth="0"/><cx:tickLabels/></cx:axis><cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis>')
    chartex(prs, 'Box and whisker', 'boxWhisker', cx_data(['A'] * 20 + ['B'] * 20, [rnd.randint(10, 60) for _ in range(20)] + [rnd.randint(30, 90) for _ in range(20)] + []),
            '<cx:layoutPr><cx:visibility meanLine="0" meanMarker="1" nonoutliers="0" outliers="1"/><cx:statistics quartileMethod="exclusive"/></cx:layoutPr>',
            axes_xml='<cx:axis id="0"><cx:catScaling gapWidth="1"/><cx:tickLabels/></cx:axis><cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis>')
    leaf = ['Laptops', 'Phones', 'Tablets', 'Shirts', 'Shoes', 'Bags', 'Apples', 'Bread']
    branch = ['Tech', 'Tech', 'Tech', 'Clothes', 'Clothes', 'Clothes', 'Food', 'Food']
    sizes = [40, 30, 12, 18, 14, 9, 7, 6]
    chartex(prs, 'Treemap', 'treemap', cx_data(leaf, sizes, levels=[leaf, branch]), '<cx:layoutPr><cx:parentLabelLayout val="overlapping"/></cx:layoutPr>', legend=True)
    chartex(prs, 'Sunburst', 'sunburst', cx_data(leaf, sizes, levels=[leaf, branch]), legend=False)
    prs.save(out / 'charts.pptx')
