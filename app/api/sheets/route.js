import { NextResponse } from 'next/server';
import { google } from 'googleapis';

// Configuração das credenciais a partir de variáveis de ambiente
function getAuth() {
  const credentials = {
    type: 'service_account',
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: process.env.GOOGLE_CERT_URL,
  };

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return auth;
}

export async function POST(request) {
  try {
    const { dados, spreadsheetId, sheetName } = await request.json();
    
    if (!dados || dados.length === 0) {
      return NextResponse.json({ error: 'Nenhum dado fornecido' }, { status: 400 });
    }

    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });

    // Formatar dados para o formato do Google Sheets
    // Colunas: DATA | CATEGORIA | DETALHE | ORIGEM | VALOR | OBS
    const values = dados.map(d => [
      d.data,
      d.categoria,
      d.detalhe,
      d.origem,
      d.valor,
      d.obs || ''
    ]);

    // Adicionar no final da planilha (append)
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId || process.env.GOOGLE_SPREADSHEET_ID,
      range: `${sheetName || 'Movimentação'}!A:F`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: values,
      },
    });

    return NextResponse.json({ 
      success: true, 
      updatedRows: response.data.updates?.updatedRows || dados.length,
      message: `${dados.length} lançamento(s) adicionado(s) com sucesso!`
    });

  } catch (error) {
    console.error('Erro ao enviar para Google Sheets:', error);
    return NextResponse.json({ 
      error: 'Erro ao enviar dados para a planilha',
      details: error.message 
    }, { status: 500 });
  }
}

// Endpoint GET para testar conexão
export async function GET() {
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    
    const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    return NextResponse.json({ 
      success: true, 
      title: response.data.properties?.title,
      sheets: response.data.sheets?.map(s => s.properties?.title)
    });

  } catch (error) {
    console.error('Erro ao conectar com Google Sheets:', error);
    return NextResponse.json({ 
      error: 'Erro ao conectar com a planilha',
      details: error.message 
    }, { status: 500 });
  }
}
