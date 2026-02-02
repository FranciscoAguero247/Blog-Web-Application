document.addEventListener("DOMContentLoaded", () => {
  let routeSuffix = 'B';
  if (document.body.classList.contains('car-theme')) routeSuffix = 'C';
  if (document.body.classList.contains('sw-theme')) routeSuffix = 'S';
  if (document.body.classList.contains('tech-theme')) routeSuffix = 'T';

  const createFormHtml = () => {
    return `
      <div class='post-div-block'>
        <form action='/Isubmit${routeSuffix}' method='POST' id='form-div'>
          <input class='input-form' type='text' name='IndividualBlogPost' placeholder='Type in a post' />
          <button class='button-19 mobile' role='button'><i>Post</i></button>
        </form>
      </div>`;
  };

  $(document).on('click', '#cloneButton', function() {
    $('#container').append(createFormHtml());
  });

 $(document).on('click', '#remove-button', function() {
    $('.internal-blog-post').remove();
    if($('#container').children().length === 0) {
        $('#container').append(createFormHtml());
    }
});

  const paragraph = document.getElementById("edit");
  const edit_button = document.getElementById("edit-button");
  const end_button = document.getElementById("end-editing");

  if (paragraph && edit_button && end_button) {
    edit_button.addEventListener("click", () => {
      paragraph.contentEditable = true;
      paragraph.style.background = "rgba(255, 255, 255, 0.2)"; 
      paragraph.focus();
    });

    end_button.addEventListener("click", () => {
      paragraph.contentEditable = false;
      paragraph.style.background = "transparent";
    });
  }

  window.triggerHype = function(btn) {
    const countSpan = btn.querySelector('.hype-count');
    if (countSpan) {
      let currentCount = parseInt(countSpan.innerText) || 0;
      countSpan.innerText = currentCount + 1;
      
  
      const glowColor = getComputedStyle(btn).color || "#34efdf";
      btn.style.boxShadow = `0 0 30px ${glowColor}`;
      setTimeout(() => {
        btn.style.boxShadow = "none";
      }, 200);
    }
  };
});