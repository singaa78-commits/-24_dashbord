/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                'point-color': '#4F46E5', // Example point color (Indigo)
            }
        },
    },
    plugins: [],
}
