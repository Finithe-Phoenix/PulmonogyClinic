// Public facts and sources are tracked in docs/CONTENT_SOURCES.md.
// Availability, preparation, prices and ages must be confirmed by the practice.
export const publicServices = [
  {
    icon: 'lungs', title: 'Consulta de neumología',
    text: 'Un espacio para conversar sobre tu salud respiratoria y revisar tus antecedentes.',
    detail: 'El perfil profesional ofrece primera consulta de neumología. Puedes conocer al especialista en Doctoralia y confirmar con el consultorio tu cita y qué información llevar a la valoración.',
  },
  {
    icon: 'pulse', title: 'Espirometría',
    text: 'Un estudio respiratorio que se realiza por indicación del profesional.',
    detail: 'El perfil profesional menciona espirometría simple y con broncodilatador. Consulta con el equipo la indicación, disponibilidad y preparación específica antes de reservar el estudio.',
  },
  {
    icon: 'route', title: 'Caminata de seis minutos',
    text: 'Consulta la disponibilidad de esta prueba y sus indicaciones particulares.',
    detail: 'La prueba de caminata de seis minutos aparece entre los servicios publicados. El consultorio debe confirmar si corresponde a tu caso y las instrucciones para el día del estudio.',
  },
  {
    icon: 'shield', title: 'Seguimiento y terapia respiratoria',
    text: 'Opciones para dar continuidad a la atención indicada en consulta.',
    detail: 'El perfil incluye visitas sucesivas y terapia respiratoria. La modalidad, frecuencia y alcance se acuerdan con el profesional durante la consulta.',
  },
];

// `previewNote` is shown only while the site is a proposal (site.config.json official=false).
export const patientQuestions: { question: string; answer: string; previewNote?: string }[] = [
  { question: '¿Cómo puedo agendar una consulta?', answer: 'Confirma el servicio y el horario directamente con recepción. La agenda principal es la del consultorio; Doctoralia se utiliza para difusión y para conocer al especialista.', previewNote: 'Esta propuesta y su demo no crean una reserva real.' },
  { question: '¿Qué necesito llevar a mi primera visita?', answer: 'Ten a la mano tus estudios previos y la información de tus tratamientos para compartirlos durante la consulta. Confirma con recepción los documentos solicitados y anota las preguntas que quieras revisar con el doctor.' },
  { question: '¿Un estudio necesita preparación especial?', answer: 'Confirma las indicaciones del estudio con el consultorio antes de acudir. La preparación depende del servicio y de tu situación; el sitio no proporciona instrucciones individuales ni cambios de tratamiento.' },
  { question: '¿Dónde puedo confirmar horarios y costos?', answer: 'Confirma con recepción el servicio, horario, costo y formas de pago antes de tu visita.', previewNote: 'Los importes que aparecen en la demo de gestión son ejemplos y no representan las tarifas del consultorio.' },
  { question: '¿Puedo enviar estudios o mi expediente aquí?', answer: 'Este sitio no recibe archivos ni datos de salud. Pregunta al consultorio por el canal autorizado para compartir tus estudios.', previewNote: 'La plataforma de gestión que puedes explorar contiene únicamente ejemplos ficticios.' },
  { question: '¿Puedo agendar una consulta para un menor de edad?', answer: 'Confirma directamente con recepción las edades atendidas y la modalidad disponible antes de agendar.' },
];
