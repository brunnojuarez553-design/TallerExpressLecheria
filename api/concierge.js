const SYSTEM_PROMPT = `Sos Express Concierge, el asistente virtual de Taller Express Lechería, un taller mecánico multimarca especialista en Toyota ubicado en Av. Anzoátegui, Lechería 6016, Anzoátegui, Venezuela. Atienden de lunes a sábado de 8 a.m. a 5 p.m. y su teléfono es +58 414-8487450.

Hablá en español latino natural, cercano y profesional. Respondé de forma breve, como una persona real del taller. Tu objetivo es orientar sin diagnosticar de manera definitiva y reunir, de a un dato por vez: servicio de interés, nombre del cliente, vehículo (marca, modelo y año) y descripción del problema. No inventes precios, disponibilidad, garantías, diagnósticos ni repuestos. Si hay una situación de seguridad (frenos sin respuesta, humo, olor fuerte a combustible, temperatura extrema), recomendá detener el vehículo y solicitar asistencia.

Devolvé exclusivamente JSON válido con esta forma:
{"reply":"respuesta al cliente","lead":{"service":"","name":"","vehicle":"","problem":""},"ready":false}

Conservá en lead los datos previos recibidos. ready debe ser true únicamente cuando haya nombre, vehículo y problema. Cuando esté listo, indicá que preparaste la consulta para enviarla por WhatsApp.`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: 'El asistente todavía no está configurado' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const history = Array.isArray(body.messages) ? body.messages.slice(-10) : [];
    const lead = body.lead && typeof body.lead === 'object' ? body.lead : {};
    const safeHistory = history
      .filter(message => ['user', 'assistant'].includes(message?.role) && typeof message?.content === 'string')
      .map(message => ({ role: message.role, content: message.content.slice(0, 1200) }));

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        temperature: 0.45,
        max_tokens: 420,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'system', content: `Datos reunidos hasta ahora: ${JSON.stringify(lead)}` },
          ...safeHistory
        ]
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('Groq error:', response.status, detail.slice(0, 300));
      return res.status(502).json({ error: 'No fue posible consultar al asistente' });
    }

    const completion = await response.json();
    const content = completion?.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(content.replace(/^```json\s*|\s*```$/g, ''));
    const mergedLead = {
      service: String(parsed?.lead?.service || lead.service || '').slice(0, 160),
      name: String(parsed?.lead?.name || lead.name || '').slice(0, 120),
      vehicle: String(parsed?.lead?.vehicle || lead.vehicle || '').slice(0, 200),
      problem: String(parsed?.lead?.problem || lead.problem || '').slice(0, 700)
    };

    return res.status(200).json({
      reply: String(parsed.reply || 'Contame un poco más para poder ayudarte.').slice(0, 900),
      lead: mergedLead,
      ready: Boolean(mergedLead.name && mergedLead.vehicle && mergedLead.problem)
    });
  } catch (error) {
    console.error('Concierge error:', error);
    return res.status(500).json({ error: 'Error interno del asistente' });
  }
};
