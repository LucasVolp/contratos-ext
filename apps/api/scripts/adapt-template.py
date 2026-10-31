"""Adapt the supplied AGU-style original document, preserving Word styles and numbering.
Usage: python scripts/adapt-template.py /path/to/original.docx
The output is bundled; source repositories are never needed at runtime.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.etree import ElementTree as E
from io import BytesIO
import sys
source=Path(sys.argv[1]);target=Path(__file__).resolve().parent.parent/'templates/arp-ata-14133.docx'
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'};W='{'+ns['w']+'}'
with ZipFile(source) as zin:
 raw=zin.read('word/document.xml')
 for _, (prefix, uri) in E.iterparse(BytesIO(raw), events=['start-ns']):E.register_namespace(prefix,uri)
 root=E.fromstring(raw);body=root.find('w:body',ns)
 def text(e):return ''.join(t.text or '' for t in e.findall('.//w:t',ns))
 def replace(p,value):
  texts=p.findall('.//w:t',ns)
  if texts:
   texts[0].text=value.split('\n')[0]
   for t in texts[1:]:t.text=''
   if '\n' in value:
    for parent in p.iter():
     for child in list(parent):
      if child.tag in [W+'br',W+'cr']:parent.remove(child)
    run=next(run for run in p.findall('.//w:r',ns) if texts[0] in list(run))
    for line in value.split('\n')[1:]:
     E.SubElement(run,W+'br');E.SubElement(run,W+'t').text=line
 remove_participants=False;remove_annex=False
 for child in list(body):
  t=text(child).strip()
  if t=='Anexo':remove_annex=True
  if remove_annex and child.tag!=W+'sectPr':body.remove(child);continue
  if t=='OU':body.remove(child);continue
  if t.startswith('Além do gerenciador, são órgãos'):
   remove_participants=True;body.remove(child);continue
  if remove_participants:
   if child.tag==W+'tbl':body.remove(child);remove_participants=False;continue
  if child.tag!=W+'p':continue
  if t.startswith('MODELO DE ATA'):replace(child,'ATA DE REGISTRO DE PREÇOS — Lei nº 14.133, de 1º de abril de 2021')
  elif t=='ÓRGÃO OU ENTIDADE PÚBLICA':replace(child,'{orgaoNome}')
  elif t.startswith('Processo Administrativo n°'):replace(child,'Processo Administrativo nº {processoAdministrativo}')
  elif t.startswith('O(A) {orgaoNome}'):
   replace(child,'O(A) {orgaoNome}, com sede em {orgaoEndereco}, na cidade de {cidade}/{UF}, inscrito(a) no CNPJ sob o nº {CNPJ}, neste ato representado(a) por {representanteCargoNome}{#temPortaria}, nomeado(a) pela Portaria nº {portariaNumero}{/temPortaria}{#temDataPortaria}, de {portariaData}{/temDataPortaria}{#temPublicacaoPortaria}, publicada no DOU de {portariaDouData}{/temPublicacaoPortaria}{#temMatricula}, matrícula funcional nº {representanteMatricula}{/temMatricula}, considerando o julgamento {#modalidadePregao}da licitação na modalidade pregão eletrônico{/modalidadePregao}{^modalidadePregao}do procedimento de contratação direta{/modalidadePregao} nº {numeroCompra}, processo administrativo nº {processoAdministrativo}, RESOLVE registrar os preços do fornecedor indicado nesta ATA, nas quantidades e condições estabelecidas no {tipoInstrumento}, sujeitando-se as partes à Lei nº 14.133, de 2021, ao Decreto nº 11.462, de 2023, e às disposições a seguir:')
  elif t.startswith('A presente Ata tem por objeto'):
   replace(child,'A presente Ata tem por objeto o registro de preços para a eventual contratação de {objeto}, conforme os itens discriminados nesta Ata e as especificações do Termo de Referência e do {tipoInstrumento} nº {numeroCompra}, partes integrantes deste instrumento, assim como a proposta do fornecedor registrado, independentemente de transcrição.')
  elif t.startswith('Além do gerenciador, não há'):replace(child,'Os órgãos e entidades participantes, quando existentes, são os identificados nos documentos do procedimento de contratação.')
  elif t.startswith('A listagem do cadastro'):replace(child,'O cadastro de reserva, quando existente, integra esta Ata conforme os anexos do procedimento de contratação.')
  elif t.startswith('DA ADESÃO'):replace(child,'DA ADESÃO À ATA DE REGISTRO DE PREÇOS')
  elif t.startswith('Não será admitida a adesão'):replace(child,'A possibilidade de adesão a esta Ata observará as condições estabelecidas no instrumento convocatório, bem como os requisitos e limites previstos a seguir.')
  elif t.startswith('Durante a vigência da ata'):replace(child,t.replace('Durante a vigência da ata,','Quando admitida no instrumento convocatório, durante a vigência da ata,'))
  elif t.startswith('A validade da Ata de Registro'):replace(child,'A vigência desta Ata observará {vigencia}, admitida prorrogação nos termos do instrumento convocatório, mediante anuência do fornecedor e comprovação de preço vantajoso.')
  elif t.startswith('Para firmeza e validade'):replace(child,'Para firmeza e validade do pactuado, a presente Ata é firmada pelas partes por meio de assinatura eletrônica, com disponibilização conforme as regras do procedimento de contratação.')
  elif t=='Local e data':replace(child,'{cidade}/{UF} — data da assinatura eletrônica.')
  elif t.startswith('Representante legal do órgão'):replace(child,'{representanteCargoNome}\n{orgaoNome}\n\n{fornecedorRazaoSocial}')
 # Supplier header is split across runs inside a cell; retain its table formatting.
 for p in root.findall('.//w:p',ns):
  t=text(p).strip()
  if t.startswith('Fornecedor {fornecedorRazaoSocial}'):replace(p,'Fornecedor: {fornecedorRazaoSocial}')
  elif t in ['X','ItemdoTR']:replace(p,'Item')
 # Trailing manual line breaks force Word to justify the final text line.
 for paragraph in root.findall('.//w:p',ns):
  descendants=list(paragraph.iter())
  for parent in paragraph.iter():
   for child in list(parent):
    if child.tag in [W+'br',W+'cr'] and child.get(W+'type')!='page':
     after=descendants[descendants.index(child)+1:]
     if not any(node.tag==W+'t' and (node.text or '').strip() for node in after):parent.remove(child)
 # Remove editing instructions, empty list entries, and inherited red/italic styling.
 for parent in root.iter():
  for child in list(parent):
   if child.tag==W+'p' and (text(child).strip() in ['(se exigida no edital)','(se exigido no edital)'] or (not text(child).strip() and child.find('w:pPr/w:numPr',ns) is not None)):
    parent.remove(child)
 for p in root.findall('.//w:p',ns):
  t=text(p).strip()
  if t.startswith('Marca') and 'exigida' in t:replace(p,'Marca')
  elif t.startswith('Modelo') and 'exigido' in t:replace(p,'Modelo')
  elif t=='QuantidadeMáxima':replace(p,'Qtd. máxima')
  elif t=='QuantidadeMínima':replace(p,'Qtd. mínima')
  elif t=='ValorUnitário':replace(p,'Valor unitário')
  elif t=='Prazo garantia ou validade':replace(p,'Garantia / validade')
  if t and ((t==t.upper() and len(t)<160) or t in ['Dos limites para as adesões','Vedação a acréscimo de quantitativos']):
   ppr=p.find('w:pPr',ns)
   if ppr is None:ppr=E.SubElement(p,W+'pPr')
   jc=ppr.find('w:jc',ns)
   if jc is None:jc=E.SubElement(ppr,W+'jc')
   jc.set(W+'val','left')
   if ppr.find('w:keepNext',ns) is None:E.SubElement(ppr,W+'keepNext')
 widths=[550,2300,650,850,550,850,850,1300,1160]
 for table in root.findall('.//w:tbl',ns):
  props=table.find('w:tblPr',ns)
  props.find('w:tblW',ns).set(W+'w',str(sum(widths)))
  props.find('w:tblInd',ns).set(W+'w','0')
  grid=table.find('w:tblGrid',ns)
  for col,width in zip(grid,widths):col.set(W+'w',str(width))
  for index,row in enumerate(table.findall('w:tr',ns)):
   rpr=row.find('w:trPr',ns)
   if rpr is None:rpr=E.SubElement(row,W+'trPr')
   for fixed in list(rpr.findall('w:trHeight',ns)):rpr.remove(fixed)
   E.SubElement(rpr,W+'cantSplit')
   if index<2:E.SubElement(rpr,W+'tblHeader')
   column=0
   for cell in row.findall('w:tc',ns):
    cpr=cell.find('w:tcPr',ns);span=cpr.find('w:gridSpan',ns)
    count=int(span.get(W+'val')) if span is not None else 1
    cpr.find('w:tcW',ns).set(W+'w',str(sum(widths[column:column+count])))
    column+=count
    if index==0 and column==1:
     paragraphs=cell.findall('w:p',ns)
     replace(paragraphs[0],'Item')
     for extra in paragraphs[1:]:cell.remove(extra)
    for old in list(cpr.findall('w:tcMar',ns)):cpr.remove(old)
    margins=E.SubElement(cpr,W+'tcMar')
    for side,value in [('top',60),('bottom',60),('left',50),('right',50)]:E.SubElement(margins,W+side,{W+'w':str(value),W+'type':'dxa'})
    for paragraph in cell.findall('.//w:p',ns):
     pp=paragraph.find('w:pPr',ns)
     if pp is None:pp=E.SubElement(paragraph,W+'pPr')
     for key in ['spacing','numPr','ind','jc']:
      for old in list(pp.findall('w:'+key,ns)):pp.remove(old)
     E.SubElement(pp,W+'spacing',{W+'before':'0',W+'after':'0',W+'line':'220',W+'lineRule':'auto'})
     E.SubElement(pp,W+'jc',{W+'val':'left'})
     for run in paragraph.findall('w:r',ns):
      rp=run.find('w:rPr',ns)
      if rp is None:rp=E.SubElement(run,W+'rPr')
      for key in ['sz','szCs','rFonts']:
       for old in list(rp.findall('w:'+key,ns)):rp.remove(old)
      E.SubElement(rp,W+'rFonts',{W+'ascii':'Arial',W+'hAnsi':'Arial',W+'cs':'Arial'})
      E.SubElement(rp,W+'sz',{W+'val':'18'});E.SubElement(rp,W+'szCs',{W+'val':'18'})
 def normalize_xml(tree):
  for parent in tree.iter():
   for child in list(parent):
    if child.tag in [W+'i',W+'iCs',W+'highlight'] or child.tag.endswith('}textFill') or (child.tag==W+'shd' and child.get(W+'fill','').upper()=='FFFF00'):
     parent.remove(child)
    elif child.tag==W+'color':child.attrib.clear();child.set(W+'val','000000')
    elif child.tag==W+'suff' and child.get(W+'val')=='nothing':child.set(W+'val','space')
  return E.tostring(tree,xml_declaration=True,encoding='UTF-8')
 data=normalize_xml(root)
 with ZipFile(target,'w',ZIP_DEFLATED) as zout:
  for info in zin.infolist():
   content=zin.read(info.filename)
   if info.filename=='word/document.xml':content=data
   elif info.filename.startswith('word/') and info.filename.endswith('.xml'):
    content=normalize_xml(E.fromstring(content))
   zout.writestr(info,content)
print(target)
