const express = require("express");

const app = express();
app.use(express.json());



const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.send("WELCOME TO BACKEND API")
});


// API ROUTES

app.listen(PORT, () => {
    console.log(`Server running on PORT: ${PORT}`);
})