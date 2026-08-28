import sql from "../configs/db.js";

export const getUserCreations = async (req, res) => {
  try {
    const { userId } = req.auth();

    const creations = await sql`
      SELECT *
      FROM creations
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `;

    res.json({
      success: true,
      creations,
    });
  } catch (error) {
    res.json({
      success: false,
      message: error.message,
    });
  }
};

export const getPublishedCreations = async (req, res) => {
  try {
    const creations = await sql`
      SELECT *
      FROM creations
      WHERE publish = true
      ORDER BY created_at DESC
    `;

    res.json({
      success: true,
      creations,
    });
  } catch (error) {
    res.json({
      success: false,
      message: error.message,
    });
  }
};

export const toggleLikeCreation = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { id } = req.body;

    const [creation] = await sql`
      SELECT *
      FROM creations
      WHERE id = ${id}
    `;

    if (!creation) {
      return res.json({
        success: false,
        message: "Creation not found",
      });
    }

    const currentLikes = creation.likes || [];
    const userIdStr = String(userId);

    let message;

    if (currentLikes.includes(userIdStr)) {
      // Unlike
      await sql`
        UPDATE creations
        SET likes = array_remove(likes, ${userIdStr})
        WHERE id = ${id}
      `;

      message = "Creation Unliked";
    } else {
      // Like
      await sql`
        UPDATE creations
        SET likes = array_append(likes, ${userIdStr})
        WHERE id = ${id}
      `;

      message = "Creation Liked";
    }

    res.json({
      success: true,
      message,
    });
  } catch (error) {
    console.log("Toggle like error:", error);

    res.json({
      success: false,
      message: error.message,
    });
  }
};